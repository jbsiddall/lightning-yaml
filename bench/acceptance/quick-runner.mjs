#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { cpus, arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sameGraph } from "./graph-equal.mjs";
import { assertExactRows } from "./rowset.mjs";
import { diagnosticInputs } from "./profile-workloads.mjs";

export const LIMIT_MS = 60_000;
export const MEMORY_ROWS = ["parse · small-records", "parse · yaml-rich-small", "stringify · yaml-rich-small", "stringify · yaml-rich-medium"];
export const CPU_ROWS = [
  "parse · medium-records", "stringify · medium-records",
  "parse · yaml-plain-medium-records", "stringify · yaml-plain-medium-records",
  "parse · yaml-rich-medium", "stringify · yaml-rich-medium",
  "parse options · yaml-plain-medium-records", "diagnostic.parse · escaped-longquotes", "diagnostic.parse · unescaped-longquotes",
];
const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, "../..");
const activeGroupsFile = process.env.LY_QUICK_ACTIVE_GROUPS;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const now = () => Number(process.hrtime.bigint() / 1_000_000n);
function dependencyVersions(root) {
  return Object.fromEntries(["tsx", "typescript", "yaml", "js-yaml"].map((name) => [name, JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version]));
}
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

function fingerprint(root) {
  const files = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, ent.name), rel = relative(root, path).replaceAll("\\", "/");
      if ([".git", "node_modules", "results", "dist", "data"].includes(ent.name)) continue;
      if (ent.isDirectory()) walk(path);
      else if (ent.isFile() && /\.(?:dfy|dtr|ts|mts|cts|js|mjs|cjs|json|yaml|yml|sh|toml)$/.test(ent.name)) files.push([rel, hash(readFileSync(path))]);
    }
  };
  for (const dir of ["src", "bench", "package.json", "pnpm-lock.yaml"]) {
    const p = join(root, dir);
    if (existsSync(p) && statSync(p).isDirectory()) walk(p);
    else if (existsSync(p)) files.push([dir, hash(readFileSync(p))]);
  }
  files.sort(([a], [b]) => a.localeCompare(b));
  const fixtureRoot = join(root, "bench/fixtures/data");
  assert.ok(existsSync(fixtureRoot), `fixture data missing at ${root}`);
  const fixtures = readdirSync(fixtureRoot).filter((name) => !name.startsWith(".")).sort().map((name) => [name, hash(readFileSync(join(fixtureRoot, name)))]);
  return { tree: hash(JSON.stringify(files)), fixtures: hash(JSON.stringify(fixtures)), files: files.length, fixtureNames: fixtures.map(([name]) => name) };
}

function loadSource(root) {
  return import(`file://${join(root, "bench/candidates.ts")}`).then(({ candidateByName }) => candidateByName("lightning-yaml"));
}
function fixtureModules(root) {
  return Promise.all([
    import(`file://${join(root, "bench/fixtures/datasets.ts")}`),
    import(`file://${join(root, "bench/oracle.ts")}`),
  ]);
}

export async function preflight(baseline, candidate) {
  const [base, next, [baseFixtures], [nextFixtures], baseApi, nextApi, nextOracle] = await Promise.all([
    loadSource(baseline), loadSource(candidate), fixtureModules(baseline).then(([fixtures]) => [fixtures]), fixtureModules(candidate).then(([fixtures]) => [fixtures]),
    import(`file://${join(baseline, "src/index.ts")}`), import(`file://${join(candidate, "src/index.ts")}`), import(`file://${join(candidate, "bench/oracle.ts")}`),
  ]);
  const datasets = ["small-records", "medium-records", "yaml-plain-medium-records", "yaml-rich-medium", "yaml-rich-small"];
  for (const name of datasets) {
    const a = baseFixtures.datasetByName(name), b = nextFixtures.datasetByName(name);
    assert.equal(a.category, b.category);
    const textA = baseFixtures.loadFixtureText(a), textB = nextFixtures.loadFixtureText(b);
    assert.equal(hash(textA), hash(textB), `fixture differs: ${name}`);
    const pa = base.parse(textA, a.category), pb = next.parse(textB, b.category);
    assert.ok(sameGraph(pa, pb), `parse preflight differs: ${name}`);
    assert.ok(sameGraph(pa, nextOracle.oracleParse(textB)), `oracle preflight differs: ${name}`);
    const oracleValue = nextOracle.oracleParse(textB);
    const sa = base.stringify(oracleValue), sb = next.stringify(oracleValue);
    assert.equal(sa, sb, `stringify preflight differs: ${name}`);
  }
  const options = { strict: true, optimizations: { internStrings: true, keyCacheMaxKb: 1 } };
  const yamlDef = nextFixtures.datasetByName("yaml-plain-medium-records");
  const yamlText = nextFixtures.loadFixtureText(yamlDef);
  assert.ok(sameGraph(baseApi.parse(yamlText, options), nextApi.parse(yamlText, options)), "options preflight differs");
  const diag = diagnosticInputs.find(({ name }) => name === "escaped-longquotes").text;
  assert.ok(sameGraph(base.parse(diag), next.parse(diag)), "diagnostic preflight differs");
}

function stopChild(child) {
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  return new Promise((resolveDone) => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } resolveDone(); }, 250);
  });
}

export async function runChild(command, args, deadline, env = process.env) {
  const remaining = deadline - now();
  if (remaining <= 0) throw Object.assign(new Error("global deadline reached"), { timedOut: true });
  const child = spawn(command, args, { cwd: TOOL_ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let stdout = "", stderr = "", expired = false;
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  let cleanup;
  const timer = setTimeout(() => { expired = true; cleanup = stopChild(child); }, remaining);
  if (activeGroupsFile) writeFileSync(activeGroupsFile, `${readFileSync(activeGroupsFile, "utf8")}${child.pid}\n`);
  const result = await new Promise((resolveDone, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveDone({ code, signal }));
  });
  if (expired) await cleanup;
  try {
    clearTimeout(timer);
    if (activeGroupsFile) {
      const pids = readFileSync(activeGroupsFile, "utf8").split("\n").filter((pid) => pid && pid !== String(child.pid));
      writeFileSync(activeGroupsFile, pids.length ? `${pids.join("\n")}\n` : "");
    }
  } catch {}
  if (expired) throw Object.assign(new Error("child exceeded global deadline"), { timedOut: true, stdout, stderr });
  if (result.code !== 0) throw new Error(`worker exited ${result.code ?? result.signal}: ${stderr.slice(-2000)}`);
  return JSON.parse(stdout.trim());
}

function schedule(round, keys) {
  return [...keys.slice(round % keys.length), ...keys.slice(0, round % keys.length)];
}

async function main() {
  const [, , baselineArg, candidateArg, outArg] = process.argv;
  assert.ok(baselineArg && candidateArg, "usage: node --import tsx bench/acceptance/quick.mjs BASELINE CANDIDATE [OUT]");
  const baseline = resolve(baselineArg), candidate = resolve(candidateArg);
  const out = resolve(outArg ?? "/tmp/ly-dafny-quick-benchmark-result.json");
  const start = now(), deadline = start + LIMIT_MS;
  const result = { protocol: "quick-estimate-v1", status: "incomplete", startedAt: new Date().toISOString(), deadlineMs: LIMIT_MS, rows: { cpu: [], memory: [] }, errors: [] };
  const save = () => {
    mkdirSync(dirname(out), { recursive: true });
    const temporary = `${out}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...result, elapsedMs: now() - start }, null, 2) + "\n");
    renameSync(temporary, out);
  };
  try {
    assert.ok(existsSync(join(baseline, "bench/memory/worker.ts")), "baseline memory worker missing");
    assert.ok(existsSync(join(candidate, "bench/memory/worker.ts")), "candidate memory worker missing");
    const baselineFingerprint = fingerprint(baseline), candidateFingerprint = fingerprint(candidate);
    const baselineDependencies = dependencyVersions(baseline), candidateDependencies = dependencyVersions(candidate);
    assert.deepEqual(baselineDependencies, candidateDependencies, "dependency versions differ");
    assert.deepEqual(baselineFingerprint.fixtureNames, candidateFingerprint.fixtureNames, "fixture names differ");
    assert.equal(baselineFingerprint.fixtures, candidateFingerprint.fixtures, "fixture bytes differ");
    await preflight(baseline, candidate);
    result.provenance = { baseline, candidate, baselineFingerprint, candidateFingerprint, harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), cpuWorkerSha256: hash(readFileSync(join(HERE, "quick-speed-sample.mjs"))), cliSha256: hash(readFileSync(join(HERE, "quick.mjs"))), supervisorSha256: hash(readFileSync(join(HERE, "quick-supervisor.mjs"))), node: process.version, executable: process.execPath, platform: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memoryIterations: 25, rounds: 3, dependencies: { baseline: baselineDependencies, candidate: candidateDependencies } };
    for (let round = 0; round < 3; round++) {
      const sides = round % 2 === 0 ? [baseline, candidate] : [candidate, baseline];
      for (const side of sides) {
        for (const key of schedule(round, MEMORY_ROWS)) {
          if (now() >= start + 38_000) throw Object.assign(new Error("memory phase budget reached"), { timedOut: true });
          const [op, dataset] = key.split(" · ");
          const raw = await runChild(process.execPath, ["--expose-gc", "--import", "tsx", join(side, "bench/memory/worker.ts"), "lightning-yaml", dataset, op, "25"], Math.min(deadline - 7_000, start + 38_000));
          assert.deepEqual([raw.candidate, raw.dataset, raw.op, raw.iters], ["lightning-yaml", dataset, op, 25], `memory worker protocol mismatch: ${key}`);
          assert.ok(Number.isFinite(raw.peakRssBytes) && raw.peakRssBytes > 0, `invalid peakRssBytes: ${key}`);
          assert.ok(Number.isFinite(raw.heapDeltaBytes), `invalid heapDeltaBytes: ${key}`);
          result.rows.memory.push({ round: round + 1, side: side === baseline ? "baseline" : "candidate", key, ...raw });
          save();
        }
      }
    }
    for (let round = 0; round < 3; round++) {
      const sides = round % 2 === 0 ? [baseline, candidate] : [candidate, baseline];
      for (const side of sides) {
        if (now() >= start + 53_000) throw Object.assign(new Error("CPU phase budget reached"), { timedOut: true });
        const raw = await runChild(process.execPath, ["--import", "tsx", join(HERE, "quick-speed-sample.mjs"), side, String(round)], Math.min(deadline - 4_000, start + 53_000));
        assertExactRows(Object.keys(raw.rows ?? {}), CPU_ROWS, `CPU ${side} round ${round + 1}`);
        validateCpuRows(raw.rows);
        result.rows.cpu.push({ round: round + 1, side: side === baseline ? "baseline" : "candidate", rows: raw.rows });
        save();
      }
    }
    const expectedMemory = MEMORY_ROWS.length * 3 * 2, expectedCpu = 3 * 2;
    assert.equal(result.rows.memory.length, expectedMemory, "memory matrix incomplete");
    assert.equal(result.rows.cpu.length, expectedCpu, "CPU matrix incomplete");
    assert.deepEqual(fingerprint(baseline), baselineFingerprint, "baseline tree/fixtures changed during run");
    assert.deepEqual(fingerprint(candidate), candidateFingerprint, "candidate tree/fixtures changed during run");
    if (now() >= deadline - 2_000) throw Object.assign(new Error("finalization reserve reached"), { timedOut: true });
    result.summary = summarize(result.rows);
    result.status = "complete";
  } catch (error) {
    result.status = error?.timedOut ? "timed-out" : "error";
    result.errors.push(String(error?.stack ?? error));
  }
  result.elapsedMs = now() - start;
  save();
  process.stdout.write(`${result.status}: ${result.elapsedMs}ms; result ${out}\n`);
  if (result.status !== "complete") process.exitCode = 1;
}

export function validateCpuRows(rows) {
  assertExactRows(Object.keys(rows ?? {}), CPU_ROWS, "CPU worker");
  for (const [key, sample] of Object.entries(rows)) {
    assert.ok(Number.isInteger(sample.warmupCalls) && sample.warmupCalls >= 16, `${key} warmup call count mismatch`);
    assert.ok(Number.isFinite(sample.warmupElapsedNs) && sample.warmupElapsedNs >= 250_000_000, `${key} warmup duration too short`);
    assert.equal(sample.nsPerCall?.length, 5, `${key} batch count mismatch`);
    assert.equal(sample.batchCalls?.length, 5, `${key} batch-call count mismatch`);
    assert.equal(sample.batchElapsedNs?.length, 5, `${key} batch-duration count mismatch`);
    assert.ok(sample.batchCalls.every((count) => Number.isInteger(count) && count > 0), `${key} invalid batch-call count`);
    assert.ok(sample.batchElapsedNs.every((duration) => Number.isFinite(duration) && duration >= 80_000_000), `${key} batch duration too short`);
    assert.ok(sample.nsPerCall.every((value, i) => value === sample.batchElapsedNs[i] / sample.batchCalls[i]), `${key} ns/call does not match batch data`);
    assert.ok(sample.nsPerCall.every((value) => Number.isFinite(value) && value > 0), `${key} invalid CPU sample`);
    const sorted = [...sample.nsPerCall].sort((a, b) => a - b);
    assert.ok(Number.isFinite(sample.medianNsPerCall) && sample.medianNsPerCall > 0, `${key} invalid median`);
    assert.equal(sample.medianNsPerCall, sorted[2], `${key} median does not match the samples`);
  }
}

export function summarize(rows) {
  const cpu = {};
  for (const key of CPU_ROWS) {
    const pairs = [];
    for (let round = 1; round <= 3; round++) {
      const b = rows.cpu.find((entry) => entry.round === round && entry.side === "baseline")?.rows?.[key]?.medianNsPerCall;
      const c = rows.cpu.find((entry) => entry.round === round && entry.side === "candidate")?.rows?.[key]?.medianNsPerCall;
      if (Number.isFinite(b) && Number.isFinite(c)) pairs.push({ round, baselineNs: b, candidateNs: c, ratio: c / b });
    }
    cpu[key] = { pairs, medianRatio: pairs.length === 3 ? median(pairs.map(({ ratio }) => ratio)) : null, ratioRange: pairs.length === 3 ? [Math.min(...pairs.map(({ ratio }) => ratio)), Math.max(...pairs.map(({ ratio }) => ratio))] : null };
  }
  const memory = {};
  for (const key of MEMORY_ROWS) {
    const pairs = [];
    for (let round = 1; round <= 3; round++) {
      const b = rows.memory.find((entry) => entry.round === round && entry.side === "baseline" && entry.key === key);
      const c = rows.memory.find((entry) => entry.round === round && entry.side === "candidate" && entry.key === key);
      if (b && c) pairs.push({ round, rssBytes: { baseline: b.peakRssBytes, candidate: c.peakRssBytes }, heapDeltaBytes: { baseline: b.heapDeltaBytes, candidate: c.heapDeltaBytes, excess: c.heapDeltaBytes - b.heapDeltaBytes }, rssRatio: b.peakRssBytes > 0 ? c.peakRssBytes / b.peakRssBytes : null, heapRatio: b.heapDeltaBytes > 4096 && c.heapDeltaBytes > 0 ? c.heapDeltaBytes / b.heapDeltaBytes : null });
    }
    const ratiosUsable = pairs.length === 3 && pairs.every((pair) => pair.heapRatio !== null);
    memory[key] = { pairs, medianRssRatio: pairs.length === 3 ? median(pairs.map(({ rssRatio }) => rssRatio)) : null, medianHeapRatio: ratiosUsable ? median(pairs.map(({ heapRatio }) => heapRatio)) : null, medianHeapExcessBytes: pairs.length === 3 ? median(pairs.map(({ heapDeltaBytes }) => heapDeltaBytes.excess)) : null };
  }
  return { cpu, memory, interpretation: "Quick estimate only; it does not satisfy the full acceptance threshold." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
