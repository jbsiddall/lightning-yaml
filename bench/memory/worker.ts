/**
 * Memory worker — runs ONE (candidate, dataset, op) in an isolated process so
 * its allocations can't pollute another candidate's measurement. Prints a
 * single JSON line to stdout for the orchestrator to collect.
 *
 * Must be launched with `--expose-gc`:
 *   node --expose-gc --import tsx bench/memory/worker.ts <candidate> <dataset> <parse|stringify> <iters>
 *
 * Reports:
 *  - peakRssBytes:  process.resourceUsage().maxRSS (peak resident set) — the
 *    true peak memory the OS handed this process.
 *  - heapDeltaBytes: heapUsed retained after GC while the last result is still
 *    reachable — an estimate of the in-memory size of one parsed/serialized result.
 */

import { candidateByName } from "../candidates.ts";
import { datasetByName, loadFixtureText, loadFixtureValue } from "../fixtures/datasets.ts";

const [, , candidateName, dataset, op, itersArg] = process.argv;
const iters = Number(itersArg) || 20;

if (op !== "parse" && op !== "stringify") {
  throw new Error(`op must be 'parse' or 'stringify', got '${op}'`);
}
if (typeof globalThis.gc !== "function") {
  throw new Error("worker must be run with --expose-gc");
}
const gc = globalThis.gc as () => void;

const candidate = candidateByName(candidateName);
if (op === "stringify" && !candidate.stringify) {
  // The orchestrator filters these out (candidateSupports), but guard direct
  // invocation too: we never borrow a foreign serializer for this candidate.
  throw new Error(`${candidateName} does not implement stringify`);
}
const ds = datasetByName(dataset);
// For stringify, the input is the in-memory value; for parse, the raw text.
const input: unknown = op === "stringify" ? loadFixtureValue(ds) : loadFixtureText(ds);

// Settle the baseline after loading the fixture.
gc();
const heapBefore = process.memoryUsage().heapUsed;

let sink: unknown;
for (let i = 0; i < iters; i++) {
  sink = op === "parse" ? candidate.parse(input as string, ds.category) : candidate.stringify!(input);
}

gc();
const heapAfter = process.memoryUsage().heapUsed;

// Keep the last result reachable across the heap measurement above so its
// retained size is counted (defeats dead-code elimination).
if (sink === Symbol.for("never")) console.error("unreachable");

const maxRss = process.resourceUsage().maxRSS;
// maxRSS is KB on Linux, bytes on macOS.
const peakRssBytes = process.platform === "darwin" ? maxRss : maxRss * 1024;

process.stdout.write(
  JSON.stringify({
    candidate: candidateName,
    dataset,
    op,
    iters,
    peakRssBytes,
    heapDeltaBytes: heapAfter - heapBefore,
  }) + "\n",
);
