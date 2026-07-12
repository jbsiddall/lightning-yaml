/**
 * Peak-memory orchestrator. Spawns one isolated worker process per
 * (candidate × dataset × op), collects the JSON result, and prints a table of
 * peak RSS and retained heap per candidate — with a ratio against JSON.
 *
 *   node --expose-gc --import tsx bench/memory/run.ts
 *
 * Workers run ONE AT A TIME (sequentially). Each is already isolated in its own
 * process (the correct model for clean peak RSS), but we do NOT run them
 * concurrently: co-running heavy parses can drive the machine into swapping,
 * which corrupts RSS readings in a way that's hard to account for. Sequential
 * keeps every number trustworthy. (Timing likewise lives in the mitata speed
 * harness, which is also sequential.)
 *
 * Env:
 *   BENCH_ITERS  iterations per worker (default 25). NOTE: peak RSS is a
 *                sustained-allocation high-water mark and GROWS with iteration
 *                count, so changing this shifts the peak-RSS numbers (heap Δ is
 *                iteration-independent). Keep it fixed for comparable results.
 *   BENCH_SCOPE  all | competition | ours  (which candidates to run).
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  selectCandidates,
  scopeFromEnv,
  candidateAppliesTo,
  candidateSupports,
  candidateHandles,
  type Scope,
} from "../candidates.ts";
import { datasets, loadFixtureText } from "../fixtures/datasets.ts";
import { formatBytes, ratio, padEnd, padStart } from "../util/format.ts";

export const ITERS = Number(process.env.BENCH_ITERS) || 25;
const OPS = ["parse", "stringify"] as const;
type Op = (typeof OPS)[number];
const workerPath = fileURLToPath(new URL("./worker.ts", import.meta.url));

export interface Result {
  candidate: string;
  dataset: string;
  op: string;
  iters: number;
  peakRssBytes: number;
  heapDeltaBytes: number;
}

function runWorker(candidate: string, dataset: string, op: Op): Result | null {
  const proc = spawnSync(
    process.execPath,
    ["--expose-gc", "--import", "tsx", workerPath, candidate, dataset, op, String(ITERS)],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (proc.status !== 0) {
    console.error(`  ! ${candidate}/${dataset}/${op} failed:\n${proc.stderr?.trim()}`);
    return null;
  }
  const line = proc.stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line) as Result;
  } catch {
    console.error(`  ! ${candidate}/${dataset}/${op}: unparseable output: ${line}`);
    return null;
  }
}

export interface MatrixOptions {
  scope?: Scope;
}

export function runMemoryMatrix(opts: MatrixOptions = {}): Result[] {
  const scope = opts.scope ?? scopeFromEnv();
  const cands = selectCandidates(scope);

  const results: Result[] = [];
  for (const ds of datasets) {
    for (const op of OPS) {
      // Cheap parse-capability probe (mirrors the speed harness): skip a partial
      // parser on a fixture it can't read yet instead of spawning a worker that
      // throws. Only for parse — stringify has no partial candidate, and loading
      // its value goes through the heavy oracle.
      const probeText = op === "parse" ? loadFixtureText(ds) : null;
      for (const c of cands) {
        // Skip candidates that don't apply to this fixture (e.g. JSON on block
        // YAML) or aren't implemented yet — no need to spawn a worker for them.
        if (!candidateAppliesTo(c, ds, op) || !candidateSupports(c, op)) continue;
        if (probeText !== null && !candidateHandles(c, "parse", probeText)) continue;
        const r = runWorker(c.name, ds.name, op);
        if (r) results.push(r);
      }
    }
  }
  return results;
}

/** Group results back into (op · dataset) sections, candidates in run order. */
function sections(results: Result[]): Array<{ label: string; rows: Result[] }> {
  const out: Array<{ label: string; rows: Result[] }> = [];
  for (const ds of datasets) {
    for (const op of OPS) {
      const rows = results.filter((r) => r.dataset === ds.name && r.op === op);
      if (rows.length) out.push({ label: `${op} · ${ds.name}`, rows });
    }
  }
  return out;
}

const COLS = { cand: 10, peak: 13, peakR: 9, heap: 14, heapR: 9 };

function textRow(cand: string, peak: string, peakR: string, heap: string, heapR: string): string {
  return (
    "  " +
    padEnd(cand, COLS.cand) +
    padStart(peak, COLS.peak) +
    padStart(peakR, COLS.peakR) +
    padStart(heap, COLS.heap) +
    padStart(heapR, COLS.heapR)
  );
}

export function formatTextTable(results: Result[]): string {
  const lines: string[] = [];
  for (const { label, rows } of sections(results)) {
    lines.push("");
    lines.push(label);
    lines.push(textRow("candidate", "peak RSS", "vs JSON", "heap Δ", "vs JSON"));
    const base = rows.find((r) => r.candidate === "JSON");
    for (const r of rows) {
      lines.push(
        textRow(
          r.candidate,
          formatBytes(r.peakRssBytes),
          base ? ratio(r.peakRssBytes, base.peakRssBytes) : "—",
          formatBytes(r.heapDeltaBytes),
          base ? ratio(r.heapDeltaBytes, base.heapDeltaBytes) : "—",
        ),
      );
    }
  }
  return lines.join("\n");
}

export function formatMarkdown(results: Result[]): string {
  const lines: string[] = [];
  for (const { label, rows } of sections(results)) {
    const base = rows.find((r) => r.candidate === "JSON");
    lines.push(`**${label}**`);
    lines.push("");
    lines.push("| candidate | peak RSS | vs JSON | heap Δ | vs JSON |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const r of rows) {
      lines.push(
        `| ${r.candidate} | ${formatBytes(r.peakRssBytes)} | ${
          base ? ratio(r.peakRssBytes, base.peakRssBytes) : "—"
        } | ${formatBytes(r.heapDeltaBytes)} | ${
          base ? ratio(r.heapDeltaBytes, base.heapDeltaBytes) : "—"
        } |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main(): void {
  const scope = scopeFromEnv();
  console.log(
    `Peak-memory benchmark — ${ITERS} iterations per candidate, isolated processes, sequential.\n` +
      `scope=${scope}\n`,
  );
  const results = runMemoryMatrix({ scope });
  console.log(formatTextTable(results));
  console.log(
    "\nNotes: peak RSS is the whole-process peak (fixed Node baseline + fixture + parser)," +
      "\nso ratios are conservative; heap Δ isolates the retained result size.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
