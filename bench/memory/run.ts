/**
 * Peak-memory orchestrator. Spawns one isolated worker process per
 * (candidate × dataset × op), collects the JSON result, and prints a table of
 * peak RSS and retained heap per candidate — with a ratio against JSON as the
 * baseline (the target the future lightning-yaml parser aims to approach).
 *
 *   node --expose-gc --import tsx bench/memory/run.ts
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { candidates } from "../candidates.ts";
import { datasets } from "../fixtures/datasets.ts";
import { formatBytes, ratio, padEnd, padStart } from "../util/format.ts";

const ITERS = 25;
const OPS = ["parse", "stringify"] as const;
const workerPath = fileURLToPath(new URL("./worker.ts", import.meta.url));

interface Result {
  candidate: string;
  dataset: string;
  op: string;
  iters: number;
  peakRssBytes: number;
  heapDeltaBytes: number;
}

function runWorker(candidate: string, dataset: string, op: string): Result | null {
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

console.log(`Peak-memory benchmark — ${ITERS} iterations per candidate, isolated processes.\n`);

const COLS = { cand: 10, peak: 13, peakR: 9, heap: 14, heapR: 9 };

function row(cand: string, peak: string, peakR: string, heap: string, heapR: string): string {
  return (
    "  " +
    padEnd(cand, COLS.cand) +
    padStart(peak, COLS.peak) +
    padStart(peakR, COLS.peakR) +
    padStart(heap, COLS.heap) +
    padStart(heapR, COLS.heapR)
  );
}

for (const ds of datasets) {
  for (const op of OPS) {
    process.stdout.write(`\n${op} · ${ds.name}\n`);
    console.log(row("candidate", "peak RSS", "vs JSON", "heap Δ", "vs JSON"));

    const results: Result[] = [];
    for (const c of candidates) {
      const r = runWorker(c.name, ds.name, op);
      if (r) results.push(r);
    }

    const baseline = results.find((r) => r.candidate === "JSON");
    for (const r of results) {
      console.log(
        row(
          r.candidate,
          formatBytes(r.peakRssBytes),
          baseline ? ratio(r.peakRssBytes, baseline.peakRssBytes) : "—",
          formatBytes(r.heapDeltaBytes),
          baseline ? ratio(r.heapDeltaBytes, baseline.heapDeltaBytes) : "—",
        ),
      );
    }
  }
}

console.log(
  "\nNotes: peak RSS is the whole-process peak (fixed Node baseline + fixture + parser)," +
    "\nso ratios are conservative; heap Δ isolates the retained result size.",
);
