/**
 * Baseline benchmark for the yaml-compat POC.
 *
 * Measures yaml v2.9.0 (parse / parseDocument / parseDocument+toJS /
 * stringify / round-trip), js-yaml 5.2.1 (load / dump), and lightning-yaml
 * (parse / stringify) against the POC corpus.
 *
 * Speed: median MB/s over N iterations, measured inline.
 * Memory: peak RSS + heap delta, measured in an isolated child process per
 *         (library × operation × fixture) — mirrors bench/memory/run.ts.
 *
 * Run:  node --expose-gc --import tsx poc/yaml-compat/bench/baseline.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// ---- libraries (lazy-imported so the orchestrator stays light) -------------
import * as yamlLib from "yaml";
import * as jsYaml from "js-yaml";
import { parse as lyParse, stringify as lyStringify } from "../../../src/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORPUS = join(HERE, "corpus");
const RESULTS = join(HERE, "..", "results");

const ITERS = Number(process.env.BENCH_ITERS) || 15;
const MEM_ITERS = Number(process.env.BENCH_MEM_ITERS) || 25;
const MEM_ITERS_LARGE = Number(process.env.BENCH_MEM_ITERS_LARGE) || 5;
// Fixtures above this threshold use reduced memory iterations (same count
// for every library on that case) to keep total runtime tractable — yaml lib
// on 5 MB allocates ~4 GB peak RSS per iteration.
const LARGE_THRESHOLD = 1_000_000;

// ---- corpus loading --------------------------------------------------------
interface Fixture {
  name: string;
  path: string;
  bytes: number;
  text: string;
  isMultidoc: boolean;
}

function loadCorpus(): Fixture[] {
  const files = readdirSync(CORPUS)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  return files.map((f) => {
    const path = join(CORPUS, f);
    const text = readFileSync(path, "utf8");
    return {
      name: f.replace(/\.yaml$/, ""),
      path,
      bytes: Buffer.byteLength(text),
      text,
      isMultidoc: f.startsWith("multidoc-"),
    };
  });
}

// ---- speed measurement (inline, median) ------------------------------------
interface SpeedResult {
  library: string;
  op: string;
  medianMs: number;
  mbps: number;
  status?: "error";
  reason?: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Time a synchronous function over N iterations, return median ms + MB/s.
 * A warm-up parse runs first so V8's tiering is past the cold-start tax —
 * matches the thesis §7 note on warm-up paying more post Apr 2025.
 */
function timeSync(
  fn: () => void,
  iters: number,
  fixtureBytes: number,
  warmup = 1,
): { medianMs: number; mbps: number } | { error: string } {
  try {
    for (let i = 0; i < warmup; i++) fn();
  } catch (e) {
    return { error: (e as Error).message ?? String(e) };
  }
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    try { fn(); } catch (e) { return { error: (e as Error).message ?? String(e) }; }
    samples.push(performance.now() - t0);
  }
  const medianMs = median(samples);
  const mbps = (fixtureBytes / (1024 * 1024)) / (medianMs / 1000);
  return { medianMs, mbps };
}

function speedForFixture(fx: Fixture): SpeedResult[] {
  const out: SpeedResult[] = [];
  const { text, bytes, isMultidoc } = fx;
  const iters = bytes > 1_000_000 ? Math.max(3, ITERS >> 2) : ITERS;

  function push(library: string, op: string, r: { medianMs: number; mbps: number } | { error: string }): void {
    if ("error" in r) {
      out.push({ library, op, medianMs: 0, mbps: 0, status: "error", reason: r.error });
      console.log(`    [error] ${library}/${op} — ${r.error}`);
    } else {
      out.push({ library, op, medianMs: r.medianMs, mbps: r.mbps });
    }
  }

  // ---- yaml lib
  push("yaml", "parse", timeSync(() => {
    if (isMultidoc) yamlLib.parseAllDocuments(text);
    else yamlLib.parse(text);
  }, iters, bytes));

  push("yaml", "parseDocument", timeSync(() => {
    if (isMultidoc) yamlLib.parseAllDocuments(text);
    else yamlLib.parseDocument(text);
  }, iters, bytes));

  push("yaml", "parseDocument+toJS", timeSync(() => {
    const docs = isMultidoc
      ? yamlLib.parseAllDocuments(text)
      : [yamlLib.parseDocument(text)];
    for (const d of docs) d.toJS();
  }, iters, bytes));

  push("yaml", "stringify(doc)", timeSync(() => {
    if (isMultidoc) {
      const docs = yamlLib.parseAllDocuments(text);
      for (const d of docs) d.toString();
    } else {
      yamlLib.parseDocument(text).toString();
    }
  }, iters, bytes));

  push("yaml", "round-trip", timeSync(() => {
    if (isMultidoc) {
      const docs = yamlLib.parseAllDocuments(text);
      for (const d of docs) yamlLib.parseDocument(d.toString());
    } else {
      yamlLib.parseDocument(yamlLib.parseDocument(text).toString());
    }
  }, iters, bytes));

  // ---- js-yaml
  push("js-yaml", "load", timeSync(() => {
    if (isMultidoc) jsYaml.loadAll(text);
    else jsYaml.load(text);
  }, iters, bytes));

  try {
    const parsed = isMultidoc ? jsYaml.loadAll(text) : jsYaml.load(text);
    push("js-yaml", "dump", timeSync(() => {
      if (Array.isArray(parsed) && isMultidoc) {
        for (const d of parsed) jsYaml.dump(d);
      } else {
        jsYaml.dump(parsed);
      }
    }, iters, bytes));
  } catch (e) {
    push("js-yaml", "dump", { error: `load failed: ${(e as Error).message ?? String(e)}` });
  }

  // ---- lightning-yaml
  push("lightning-yaml", "parse", timeSync(() => lyParse(text), iters, bytes));

  try {
    const parsed = lyParse(text);
    push("lightning-yaml", "stringify", timeSync(() => lyStringify(parsed), iters, bytes));
  } catch (e) {
    push("lightning-yaml", "stringify", { error: `parse failed: ${(e as Error).message ?? String(e)}` });
  }

  return out;
}

// ---- memory measurement (child process, mirrors bench/memory/run.ts) -------
interface MemoryResult {
  library: string;
  op: string;
  peakRssBytes: number;
  heapDeltaBytes: number;
  status?: "error";
  reason?: string;
}

/**
 * Spawn an isolated child process that runs one (library, op, fixture) combo
 * for N iterations and reports peak RSS + heap delta. One child per cell —
 * sequential — to keep peak RSS trustworthy.
 */
function memoryForCell(fx: Fixture, library: string, op: string, memIters: number): MemoryResult {
  const workerPath = join(HERE, "baseline-worker.ts");
  const proc = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--import", "tsx",
      workerPath,
      fx.path,
      library,
      op,
      String(memIters),
      fx.isMultidoc ? "1" : "0",
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 300_000 },
  );
  if (proc.status !== 0) {
    const reason = proc.stderr?.trim().split("\n").pop() ?? "unknown error";
    console.error(`  ! memory ${library}/${op}/${fx.name}: ${reason}`);
    return { library, op, peakRssBytes: 0, heapDeltaBytes: 0, status: "error", reason };
  }
  const line = proc.stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line) as MemoryResult;
  } catch {
    const reason = `unparseable output: ${line.slice(0, 120)}`;
    console.error(`  ! memory ${library}/${op}/${fx.name}: ${reason}`);
    return { library, op, peakRssBytes: 0, heapDeltaBytes: 0, status: "error", reason };
  }
}

const MEMORY_OPS: Array<{ library: string; ops: string[] }> = [
  { library: "yaml", ops: ["parse", "parseDocument", "parseDocument+toJS", "stringify(doc)", "round-trip"] },
  { library: "js-yaml", ops: ["load", "dump"] },
  { library: "lightning-yaml", ops: ["parse", "stringify"] },
];

function memItersFor(fx: Fixture): number {
  return fx.bytes > LARGE_THRESHOLD ? MEM_ITERS_LARGE : MEM_ITERS;
}

function memoryForFixture(fx: Fixture): { results: MemoryResult[]; memIters: number } {
  const memIters = memItersFor(fx);
  const out: MemoryResult[] = [];
  for (const { library, ops } of MEMORY_OPS) {
    for (const op of ops) {
      out.push(memoryForCell(fx, library, op, memIters));
    }
  }
  return { results: out, memIters };
}

// ---- output ----------------------------------------------------------------
function fmtBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

function yamlScalar(v: string | number): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (/[:#\[\]{},&*?|>'"%@`]/.test(v) || /^\s|\s$/.test(v)) return JSON.stringify(v);
  return v;
}

function writeResults(
  speed: Array<{ fixture: string; size: number; results: SpeedResult[]; speedIters: number }>,
  memory: Array<{ fixture: string; size: number; results: MemoryResult[]; memIters: number }>,
): void {
  const lines: string[] = [];
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const gitSha = sha.status === 0 ? sha.stdout.trim() : "unknown";
  lines.push("# Baseline benchmark results — poc/yaml-compat");
  lines.push(`# machine: ${process.platform} ${process.arch}`);
  lines.push(`# node: ${process.version}`);
  lines.push(`# yaml: 2.9.0`);
  lines.push(`# js-yaml: 5.2.1`);
  lines.push(`# lightning-yaml: main@${gitSha}`);
  lines.push(`# date: ${new Date().toISOString()}`);
  lines.push(`# git-sha: ${gitSha}`);
  lines.push(`# speed-iters: ${ITERS} (fixtures >1MB: ${Math.max(3, ITERS >> 2)})`);
  lines.push(`# memory-iters: ${MEM_ITERS} (fixtures >1MB: ${MEM_ITERS_LARGE})`);
  lines.push(`# large-threshold: ${LARGE_THRESHOLD} bytes`);
  lines.push("");
  lines.push("speed:");
  for (const { fixture, size, results, speedIters } of speed) {
    lines.push(`  - fixture: ${yamlScalar(fixture)}`);
    lines.push(`    size_bytes: ${size}`);
    lines.push(`    iters: ${speedIters}`);
    lines.push(`    rows:`);
    for (const r of results) {
      lines.push(`      - library: ${yamlScalar(r.library)}`);
      lines.push(`        op: ${yamlScalar(r.op)}`);
      if (r.status === "error") {
        lines.push(`        status: error`);
        lines.push(`        reason: ${yamlScalar(r.reason ?? "unknown")}`);
      } else {
        lines.push(`        median_ms: ${r.medianMs.toFixed(3)}`);
        lines.push(`        mbps: ${r.mbps.toFixed(2)}`);
      }
    }
  }
  lines.push("");
  lines.push("memory:");
  for (const { fixture, size, results, memIters } of memory) {
    lines.push(`  - fixture: ${yamlScalar(fixture)}`);
    lines.push(`    size_bytes: ${size}`);
    lines.push(`    iters: ${memIters}`);
    lines.push(`    rows:`);
    for (const r of results) {
      lines.push(`      - library: ${yamlScalar(r.library)}`);
      lines.push(`        op: ${yamlScalar(r.op)}`);
      if (r.status === "error") {
        lines.push(`        status: error`);
        lines.push(`        reason: ${yamlScalar(r.reason ?? "unknown")}`);
      } else {
        lines.push(`        peak_rss_bytes: ${r.peakRssBytes}`);
        lines.push(`        heap_delta_bytes: ${r.heapDeltaBytes}`);
      }
    }
  }

  if (!existsSync(RESULTS)) {
    mkdirSync(RESULTS, { recursive: true });
  }
  const outPath = join(RESULTS, "baseline.yaml");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nResults written to ${outPath}`);
}

// ---- main ------------------------------------------------------------------
function main(): void {
  const corpus = loadCorpus();
  console.log(`POC baseline benchmark — ${corpus.length} fixtures`);
  console.log(`  speed iters: ${ITERS} (large: ${Math.max(3, ITERS >> 2)})`);
  console.log(`  memory iters: ${MEM_ITERS} (large >${(LARGE_THRESHOLD / 1024 / 1024).toFixed(0)}MB: ${MEM_ITERS_LARGE})`);
  console.log(`Node ${process.version} · yaml 2.9.0 · js-yaml 5.2.1 · lightning-yaml (local)\n`);

  const speedOut: Array<{ fixture: string; size: number; results: SpeedResult[]; speedIters: number }> = [];
  const memOut: Array<{ fixture: string; size: number; results: MemoryResult[]; memIters: number }> = [];

  console.log("== Speed ==");
  for (const fx of corpus) {
    const speedIters = fx.bytes > LARGE_THRESHOLD ? Math.max(3, ITERS >> 2) : ITERS;
    console.log(`  ${fx.name} (${fmtBytes(fx.bytes)}, ${speedIters} iters)`);
    const results = speedForFixture(fx);
    speedOut.push({ fixture: fx.name, size: fx.bytes, results, speedIters });
    for (const r of results) {
      if (r.status === "error") {
        console.log(`    ${r.library.padEnd(15)} ${r.op.padEnd(22)} ERROR: ${r.reason}`);
      } else {
        console.log(`    ${r.library.padEnd(15)} ${r.op.padEnd(22)} ${r.mbps.toFixed(1).padStart(8)} MB/s  (${r.medianMs.toFixed(1)} ms)`);
      }
    }
  }

  // Checkpoint speed results before memory section (which may crash on large fixtures).
  writeResults(speedOut, memOut);

  console.log("\n== Memory (child-process isolation, sequential) ==");
  for (const fx of corpus) {
    const mi = memItersFor(fx);
    console.log(`  ${fx.name} (${fmtBytes(fx.bytes)}, ${mi} mem iters)`);
    const { results } = memoryForFixture(fx);
    memOut.push({ fixture: fx.name, size: fx.bytes, results, memIters: mi });
    for (const r of results) {
      console.log(`    ${r.library.padEnd(15)} ${r.op.padEnd(22)} RSS ${fmtBytes(r.peakRssBytes).padStart(10)}  heap Δ ${fmtBytes(r.heapDeltaBytes)}`);
    }
    // Checkpoint after each fixture so a crash loses nothing.
    writeResults(speedOut, memOut);
  }

  writeResults(speedOut, memOut);
}

main();
