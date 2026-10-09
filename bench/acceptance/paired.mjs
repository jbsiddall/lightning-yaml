#!/usr/bin/env node
// Paired, sequential whole-library acceptance runner. No command measures CPU
// unless `LY_PERF_AUTHORIZED=YES` is set for the explicit `measure` mode.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { cpus, arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertExactRows } from "./rowset.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const yaml = require("yaml");
const fixtureNamesExpected = [
  "large-nested", "large-records", "medium-nested", "medium-records",
  "small-records", "xlarge-records", "yaml-plain-large-records",
  "yaml-plain-medium-nested", "yaml-plain-medium-records",
  "yaml-plain-small-records", "yaml-rich-large", "yaml-rich-medium", "yaml-rich-small",
].sort();
const AUTH = "LY_PERF_AUTHORIZED";
const [, , mode, ...args] = process.argv;

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i++) {
    const arg = values[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "help") out.help = true;
    else {
      const value = values[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      out[key] = value;
    }
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node bench/acceptance/paired.mjs plan --baseline ROOT --candidate ROOT [--runs 7] [--out DIR]
  node --import tsx bench/acceptance/paired.mjs preflight --baseline ROOT --candidate ROOT
  LY_PERF_AUTHORIZED=YES node bench/acceptance/paired.mjs measure --baseline ROOT --candidate ROOT [--runs 7] [--out DIR]

`);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function treeHash(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute).replaceAll("\\", "/");
      if ([".git", "node_modules", "results", "dist", "bench/fixtures/data", "bench/yaml-test-suite/data", "bench/browser/generated"].includes(rel)) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && /\.(?:dfy|ts|mts|cts|js|mjs|cjs|json)$/.test(entry.name)) {
        files.push([relative(root, absolute).replaceAll("\\", "/"), sha256(readFileSync(absolute))]);
      }
    }
  };
  for (const dir of ["src", "bench", "test"]) if (existsSync(join(root, dir))) walk(join(root, dir));
  for (const file of ["package.json", "pnpm-lock.yaml", "tsup.config.ts", "bench/bundlesize/package.json", "bench/bundlesize/pnpm-lock.yaml"]) {
    if (existsSync(join(root, file))) files.push([file, sha256(readFileSync(join(root, file)))]);
  }
  files.sort((a, b) => a[0].localeCompare(b[0]));
  return sha256(JSON.stringify(files));
}

function directoryHash(root) {
  assert.ok(existsSync(root), `built artifact directory missing: ${root}`);
  const entries = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) entries.push([relative(root, absolute).replaceAll("\\", "/"), sha256(readFileSync(absolute))]);
    }
  };
  walk(root);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return sha256(JSON.stringify(entries));
}

function fixtureManifest(root, fallbackRoot = root) {
  const expectedDir = join(root, "bench/fixtures/data");
  const dir = existsSync(expectedDir) ? expectedDir : join(fallbackRoot, "bench/fixtures/data");
  assert.ok(existsSync(dir), `fixture directory missing: ${dir}`);
  const files = readdirSync(dir).filter((name) => !name.startsWith(".")).sort();
  const names = files.map((file) => file.replace(/\.(?:json|yaml)$/, "")).sort();
  assert.deepEqual(names, fixtureNamesExpected, `fixture set differs at ${root}`);
  return files.map((file) => {
    const bytes = readFileSync(join(dir, file));
    return { file, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function packageVersions(root) {
  const wanted = ["mitata", "yaml", "js-yaml", "tsx", "typescript", "vitest", "zod"];
  const versions = {};
  for (const name of wanted) {
    const path = join(root, "node_modules", name, "package.json");
    assert.ok(existsSync(path), `${name} is not installed under ${root}`);
    versions[name] = JSON.parse(readFileSync(path, "utf8")).version;
  }
  return versions;
}

function ensureCandidateFixtures(candidate, baseline) {
  const target = join(candidate, "bench/fixtures/data");
  if (existsSync(target)) return;
  try {
    const stat = lstatSync(target);
    if (!stat.isSymbolicLink()) throw new Error(`fixture path exists but is not readable: ${target}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  symlinkSync(realpathSync(join(baseline, "bench/fixtures/data")), target, "dir");
}

function ensureCandidateBundleToolchain(candidate, baseline) {
  const target = join(candidate, "bench/bundlesize/node_modules");
  const source = join(baseline, "bench/bundlesize/node_modules");
  assert.ok(existsSync(source), `baseline bundle toolchain is missing: ${source}`);
  if (!existsSync(target)) symlinkSync(realpathSync(source), target, "dir");
}

function metadata(root, fallbackFixtureRoot = root) {
  const headPath = join(root, ".git", "HEAD");
  assert.ok(existsSync(headPath), `git HEAD file missing: ${headPath}`);
  const headText = readFileSync(headPath, "utf8").trim();
  let head = headText;
  if (headText.startsWith("ref: ")) {
    const ref = headText.slice(5);
    const refPath = join(root, ".git", ref);
    if (existsSync(refPath)) head = readFileSync(refPath, "utf8").trim();
    else {
      const packed = readFileSync(join(root, ".git", "packed-refs"), "utf8").split("\n");
      const line = packed.find((entry) => entry.endsWith(` ${ref}`));
      assert.ok(line, `could not resolve git ref ${ref}`);
      head = line.split(" ", 1)[0];
    }
  }
  return {
    root,
    gitHead: head,
    worktreeStatus: "content is fingerprinted below; no child git status command is required",
    fixtureSourceRoot: existsSync(join(root, "bench/fixtures/data")) ? root : fallbackFixtureRoot,
    sourceTreeSha256: treeHash(root),
    packageSha256: sha256(readFileSync(join(root, "package.json"))),
    lockfileSha256: sha256(readFileSync(join(root, "pnpm-lock.yaml"))),
    bundleLockfileSha256: sha256(readFileSync(join(root, "bench/bundlesize/pnpm-lock.yaml"))),
    dependencies: packageVersions(root),
    fixtures: fixtureManifest(root, fallbackFixtureRoot),
  };
}

function validateInputs(baseline, candidate) {
  const base = metadata(baseline), next = metadata(candidate, baseline);
  for (const field of ["lockfileSha256", "bundleLockfileSha256"]) {
    assert.equal(base[field], next[field], `${field} differs between baseline and candidate`);
  }
  assert.deepEqual(base.dependencies, next.dependencies, "root dependency versions differ");
  assert.deepEqual(base.fixtures, next.fixtures, "fixture names, bytes, or contents differ");
  const env = {
    node: process.version,
    packageManager: JSON.parse(readFileSync(join(baseline, "package.json"), "utf8")).packageManager ?? "unknown",
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    nodeExecutable: process.execPath,
    dependencies: base.dependencies,
  };
  return { baseline: base, candidate: next, env };
}

function newestYaml(root, name) {
  const path = join(root, "results/benchmarks", name);
  assert.ok(existsSync(path), `missing benchmark output: ${path}`);
  return { path, value: yaml.parse(readFileSync(path, "utf8")) };
}

function median(values) {
  const xs = [...values].sort((a, b) => a - b);
  assert.ok(xs.length > 0, "median of empty data");
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function percentile(values, p) {
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 1) return xs[0];
  return xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
}

function ratiosFromPairs(pairValues) {
  const rs = pairValues.map(({ base, candidate }) => candidate / base);
  return { pairedRatios: rs, medianRatio: median(rs), p10: percentile(rs, 0.1), p90: percentile(rs, 0.9) };
}

function summarizeMemory(rowsBySample, runs) {
  const summary = [];
  for (const op of ["parse", "stringify"]) {
    for (const workload of fixtureNamesExpected) {
      const rssPairs = [], heapPairs = [];
      const baseRss = [], candidateRss = [], baseHeap = [], candidateHeap = [];
      for (let i = 0; i < runs; i++) {
        const get = (side) => rowsBySample[`memory-${i}-${side}`].find((r) => r.candidate === "lightning-yaml" && r.op === op && r.dataset === workload);
        const b = get("baseline"), c = get("candidate");
        assert.ok(b && c, `missing paired memory row ${op}/${workload}/run-${i}`);
        baseRss.push(b.peakRssBytes); candidateRss.push(c.peakRssBytes);
        baseHeap.push(b.heapDeltaBytes); candidateHeap.push(c.heapDeltaBytes);
        rssPairs.push({ base: b.peakRssBytes, candidate: c.peakRssBytes });
        heapPairs.push({ base: b.heapDeltaBytes, candidate: c.heapDeltaBytes });
      }
      const heapUsable = heapPairs.every((p) => p.base > 4096 && p.candidate > 0);
      summary.push({
        suite: "memory", operation: op, workload,
        peakRssBaselineMedianBytes: median(baseRss), peakRssCandidateMedianBytes: median(candidateRss),
        peakRss: ratiosFromPairs(rssPairs),
        retainedHeapBaselineMedianBytes: median(baseHeap), retainedHeapCandidateMedianBytes: median(candidateHeap),
        retainedHeapPairedDeltaMedianBytes: median(heapPairs.map((p) => p.candidate - p.base)),
        retainedHeapRatio: heapUsable ? ratiosFromPairs(heapPairs) : "low-signal: baseline heap delta <= 4 KiB or a paired value is non-positive; report signed byte deltas only",
      });
    }
  }
  return summary;
}

function parseSample(output, label) {
  try { return JSON.parse(output.trim()); }
  catch (error) { throw new Error(`invalid JSON from ${label}: ${error}`); }
}

function saveSample(outDir, suite, index, side, payload, stdout, stderr, command, sourceMeta) {
  const base = `${suite}-${index}-${side}`;
  writeFileSync(join(outDir, `${base}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(outDir, `${base}.stdout.log`), stdout);
  writeFileSync(join(outDir, `${base}.stderr.log`), stderr);
  writeFileSync(join(outDir, `${base}.command.json`), `${JSON.stringify({ command, source: sourceMeta, generatedAt: new Date().toISOString() }, null, 2)}\n`);
}

function sampleCommand(root, script, args = [], loader = true) {
  const argv = [...(loader ? ["--import", "tsx"] : []), script, ...args];
  return { command: process.execPath, args: argv, cwd: root };
}

function runSample(command, env = process.env) {
  const result = spawnSync(command.command, command.args, { cwd: command.cwd, env, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`benchmark command failed (${result.status}): ${command.command} ${command.args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function main() {
  if (!mode || mode === "--help") return usage();
  const opts = parseArgs(args);
  if (opts.help) return usage();
  const baseline = resolve(opts.baseline ?? "");
  const candidate = resolve(opts.candidate ?? "");
  assert.ok(opts.baseline && opts.candidate, "--baseline and --candidate are required");
  const runs = Number(opts.runs ?? 7);
  assert.ok(Number.isInteger(runs) && runs >= 5 && runs <= 15, "--runs must be an integer from 5 to 15");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outDir = resolve(opts.out ?? `/tmp/ly-dafny-performance-${stamp}`);

  if (mode === "plan") {
    const inputs = validateInputs(baseline, candidate);
    console.log(JSON.stringify({ mode, runs, outDir, inputs, schedule: ["semantic preflight", "build outputs", "7 × rotated full speed matrix", "7 × rotated facade/option profiles", "7 × rotated 25-iteration memory matrix", "7 × fresh ESM/CJS import pairs", "one sequential bundle-size matrix per tree", "paired row validation and summary"], cpuBenchmarksRun: false }, null, 2));
    return;
  }
  if (mode === "preflight") {
    const inputs = validateInputs(baseline, candidate);
    const command = sampleCommand(TOOL_ROOT, join(HERE, "preflight.mjs"), [baseline, candidate]);
    const result = runSample(command, { ...process.env, LY_NODE_PATH: "" });
    process.stdout.write(result.stdout);
    console.log(JSON.stringify({ mode, inputs }));
    return;
  }
  if (mode !== "measure") throw new Error(`unknown mode ${mode}`);
  assert.equal(process.env[AUTH], "YES", `measurement is disabled; set ${AUTH}=YES only after the root schedules a quiet run`);
  assert.equal(process.env.LY_NODE, process.execPath, "source /tmp/ly-dafny-env.sh before measurement so runtime provenance is exact");
  const inputs = validateInputs(baseline, candidate);
  mkdirSync(outDir, { recursive: true });
  ensureCandidateFixtures(candidate, baseline);
  ensureCandidateBundleToolchain(candidate, baseline);
  writeFileSync(join(outDir, "input-manifest.json"), `${JSON.stringify({ startedAt: new Date().toISOString(), runs, inputs }, null, 2)}\n`);

  const preflight = runSample(sampleCommand(TOOL_ROOT, join(HERE, "preflight.mjs"), [baseline, candidate]));
  writeFileSync(join(outDir, "preflight.log"), preflight.stdout + preflight.stderr);

  // Build both package formats once before collecting cold-start imports.
  const buildOrder = runs % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
  for (const side of buildOrder) {
    const root = side === "baseline" ? baseline : candidate;
    const command = { command: process.env.LY_PNPM ?? "pnpm", args: ["build"], cwd: root };
    const result = runSample(command);
    writeFileSync(join(outDir, `build-${side}.log`), result.stdout + result.stderr);
  }
  const builtArtifacts = {
    baseline: directoryHash(join(baseline, "dist")),
    candidate: directoryHash(join(candidate, "dist")),
  };
  writeFileSync(join(outDir, "built-artifacts.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...builtArtifacts }, null, 2)}\n`);

  const sampleRows = {};
  const suites = ["speed", "profiles", "memory"];
  for (let i = 0; i < runs; i++) {
    for (const suite of suites) {
      const order = (i + suites.indexOf(suite)) % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
      for (const side of order) {
        const root = side === "baseline" ? baseline : candidate;
        const script = join(HERE, `${suite === "speed" ? "speed" : suite === "profiles" ? "profile" : "memory"}-sample.mjs`);
        const env = { ...process.env, BENCH_SCOPE: "ours", BENCH_ITERS: "25" };
        const argsForScript = [root];
        const command = sampleCommand(root, script, argsForScript);
        const result = runSample(command, env);
        const payload = parseSample(result.stdout, `${suite}/${side}/${i}`);
        if (suite === "speed") {
          assertExactRows(payload.rows.parse.filter((r) => r.library === "lightning-yaml").map((r) => r.workload), fixtureNamesExpected, `${side} speed parse`);
          assertExactRows(payload.rows.stringify.filter((r) => r.library === "lightning-yaml").map((r) => r.workload), fixtureNamesExpected, `${side} speed stringify`);
        } else if (suite === "memory") {
          for (const op of ["parse", "stringify"]) {
            assertExactRows(payload.results.filter((r) => r.candidate === "lightning-yaml" && r.op === op).map((r) => r.dataset), fixtureNamesExpected, `${side} memory ${op}`);
          }
        }
        sampleRows[`${suite}-${i}-${side}`] = payload.rows ?? payload.results;
        saveSample(outDir, suite, i, side, payload, result.stdout, result.stderr, command, inputs[side]);
      }
    }
    for (const kind of ["esm", "cjs"]) {
      const order = (i + (kind === "cjs" ? 1 : 0)) % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
      for (const side of order) {
        const root = side === "baseline" ? baseline : candidate;
        const command = sampleCommand(TOOL_ROOT, join(HERE, "cold-import.mjs"), [root, kind], false);
        const result = runSample(command);
        const payload = parseSample(result.stdout, `cold-import/${kind}/${side}/${i}`);
        const key = `startup-${kind}-${side}`;
        sampleRows[key] ??= [];
        sampleRows[key].push(payload.importNs);
        saveSample(outDir, `startup-${kind}`, i, side, payload, result.stdout, result.stderr, command, inputs[side]);
      }
    }
  }

  // Bundle size is deterministic; run once per tree in reversed order from
  // the first paired suite to blunt cache/order effects, and require complete
  // success for every bundler that is available in both trees.
  const bundleDocs = {};
  for (const side of ["candidate", "baseline"]) {
    const root = side === "baseline" ? baseline : candidate;
    const command = { command: process.execPath, args: ["bench/bundlesize/run.mjs"], cwd: root };
    const result = runSample(command);
    writeFileSync(join(outDir, `bundle-${side}.stdout.log`), result.stdout);
    writeFileSync(join(outDir, `bundle-${side}.stderr.log`), result.stderr);
    bundleDocs[side] = newestYaml(root, "bundle-size.yaml").value;
    assert.equal(bundleDocs[side].suite, "bundle-size");
  }
  const baseBundle = bundleDocs.baseline.results.map((r) => r.bundler).sort();
  const candidateBundle = bundleDocs.candidate.results.map((r) => r.bundler).sort();
  assert.deepEqual(candidateBundle, baseBundle, "active bundle toolchain rows differ");
  assert.deepEqual(baseBundle, ["bun", "deno", "rolldown", "vite", "webpack"], "one or more expected bundle tools were not available");
  const bundleSummary = [];
  for (const bundler of baseBundle) {
    const b = bundleDocs.baseline.results.find((r) => r.bundler === bundler).values["lightning-yaml"];
    const c = bundleDocs.candidate.results.find((r) => r.bundler === bundler).values["lightning-yaml"];
    assert.ok(b?.gzip && c?.gzip, `bundle output missing for ${bundler}`);
    bundleSummary.push({ bundler, baselineGzip: b.gzip, candidateGzip: c.gzip, baselineMin: b.min, candidateMin: c.min, baselineBrotli: b.brotli, candidateBrotli: c.brotli });
  }

  const speedSummary = [];
  const profileSummary = [];
  for (let i = 0; i < runs; i++) {
    // Use paired raw records, preserving each round rather than selecting the
    // favorable whole-run or aggregate statistic.
    for (const op of ["parse", "stringify"]) {
      const base = sampleRows[`speed-${i}-baseline`][op].filter((r) => r.library === "lightning-yaml");
      const cand = sampleRows[`speed-${i}-candidate`][op].filter((r) => r.library === "lightning-yaml");
      assert.deepEqual(cand.map((r) => r.workload), base.map((r) => r.workload));
    }
  }
  for (const op of ["parse", "stringify"]) {
    for (const workload of fixtureNamesExpected) {
      const speedPair = [];
      for (let i = 0; i < runs; i++) {
        const b = sampleRows[`speed-${i}-baseline`][op].find((r) => r.library === "lightning-yaml" && r.workload === workload).avg;
        const c = sampleRows[`speed-${i}-candidate`][op].find((r) => r.library === "lightning-yaml" && r.workload === workload).avg;
        speedPair.push({ base: b, candidate: c });
      }
      speedSummary.push({ operation: op, workload, baselineMedianNs: median(speedPair.map((p) => p.base)), candidateMedianNs: median(speedPair.map((p) => p.candidate)), ...ratiosFromPairs(speedPair) });
    }
  }
  for (let i = 0; i < runs; i++) {
    const b = sampleRows[`profiles-${i}-baseline`].rows;
    const c = sampleRows[`profiles-${i}-candidate`].rows;
    assert.deepEqual(c.map((r) => [r.workload, r.profile]), b.map((r) => [r.workload, r.profile]), "facade/profile row set differs");
  }
  for (const ref of sampleRows["profiles-0-baseline"].rows) {
    const pairs = [];
    for (let i = 0; i < runs; i++) {
      const find = (side) => sampleRows[`profiles-${i}-${side}`].rows.find((r) => r.workload === ref.workload && r.profile === ref.profile).avg;
      pairs.push({ base: find("baseline"), candidate: find("candidate") });
    }
    profileSummary.push({ profile: ref.profile, workload: ref.workload, baselineMedianNs: median(pairs.map((p) => p.base)), candidateMedianNs: median(pairs.map((p) => p.candidate)), ...ratiosFromPairs(pairs) });
  }
  const memoryRows = {};
  for (let i = 0; i < runs; i++) {
    memoryRows[`memory-${i}-baseline`] = sampleRows[`memory-${i}-baseline`];
    memoryRows[`memory-${i}-candidate`] = sampleRows[`memory-${i}-candidate`];
  }
  const memorySummary = [];
  for (const op of ["parse", "stringify"]) {
    for (const workload of fixtureNamesExpected) {
      const rssPairs = [], heapPairs = [];
      for (let i = 0; i < runs; i++) {
        const get = (side) => memoryRows[`memory-${i}-${side}`].find((r) => r.candidate === "lightning-yaml" && r.op === op && r.dataset === workload);
        const b = get("baseline"), c = get("candidate");
        assert.ok(b && c, `missing paired memory result ${op}/${workload}/${i}`);
        rssPairs.push({ base: b.peakRssBytes, candidate: c.peakRssBytes });
        heapPairs.push({ base: b.heapDeltaBytes, candidate: c.heapDeltaBytes });
      }
      const heapUsable = heapPairs.every((p) => p.base > 4096 && p.candidate > 0);
      memorySummary.push({
        operation: op, workload,
        peakRssBaselineMedianBytes: median(rssPairs.map((p) => p.base)),
        peakRssCandidateMedianBytes: median(rssPairs.map((p) => p.candidate)),
        peakRss: ratiosFromPairs(rssPairs),
        heapBaselineMedianBytes: median(heapPairs.map((p) => p.base)),
        heapCandidateMedianBytes: median(heapPairs.map((p) => p.candidate)),
        heapPairedDeltaMedianBytes: median(heapPairs.map((p) => p.candidate - p.base)),
        heapRatio: heapUsable ? ratiosFromPairs(heapPairs) : "low-signal: baseline heap delta <= 4 KiB or paired heap value non-positive; retain signed byte deltas without a ratio",
      });
    }
  }
  const startupSummary = [];
  for (const kind of ["esm", "cjs"]) {
    const base = sampleRows[`startup-${kind}-baseline`], cand = sampleRows[`startup-${kind}-candidate`];
    const pairs = base.map((v, i) => ({ base: v, candidate: cand[i] }));
    startupSummary.push({ format: kind, baselineMedianNs: median(base), candidateMedianNs: median(cand), ...ratiosFromPairs(pairs) });
  }
  const summary = { generatedAt: new Date().toISOString(), runs, threshold: 1.15, speed: speedSummary, profiles: profileSummary, memory: memorySummary, startup: startupSummary, bundle: bundleSummary, bundleVersions: { baseline: bundleDocs.baseline.env.bundlers, candidate: bundleDocs.candidate.env.bundlers } };
  const misses = [];
  for (const row of speedSummary) if (row.medianRatio > 1.15) misses.push({ metric: "time", ...row });
  for (const row of profileSummary) if (row.medianRatio > 1.15) misses.push({ metric: "facade-profile-time", ...row });
  for (const row of memorySummary) if (row.peakRss.medianRatio > 1.15) misses.push({ metric: "peak-rss", ...row });
  for (const row of memorySummary) {
    if (typeof row.heapRatio === "object" && row.heapRatio.medianRatio > 1.15) misses.push({ metric: "retained-heap", ...row });
  }
  for (const row of startupSummary) if (row.medianRatio > 1.15) misses.push({ metric: "cold-import", ...row });
  for (const row of bundleSummary) if (row.candidateGzip / row.baselineGzip > 1.15) misses.push({ metric: "gzip-size", ...row, medianRatio: row.candidateGzip / row.baselineGzip });
  summary.over15Percent = misses;
  summary.acceptance = misses.length === 0 ? "pass" : "fail: investigate every over-threshold row; no aggregate score substitutes for row-level review";
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, "environment.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...inputs }, null, 2)}\n`);
  console.log(JSON.stringify({ outDir, acceptance: summary.acceptance, over15PercentRows: misses.length, rows: { speed: speedSummary.length, profiles: profileSummary.length, memory: memorySummary.length, startup: startupSummary.length, bundle: bundleSummary.length } }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
