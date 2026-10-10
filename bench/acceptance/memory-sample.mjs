#!/usr/bin/env node
// Exact-byte companion to bench/memory/run.ts. The existing worker matrix and
// iteration count are reused; this emits the raw Result[] before YAML rounding.

import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? process.cwd());
const iterations = Number(process.env.BENCH_ITERS ?? 25);
assert.equal(iterations, 25, "acceptance memory samples must use the fixed 25 iterations");
process.env.BENCH_ITERS = String(iterations);
process.env.BENCH_SCOPE = "ours";
const memory = await import(pathToFileURL(join(root, "bench/memory/run.ts")).href);
const fixtures = await import(pathToFileURL(join(root, "bench/fixtures/datasets.ts")).href);
const results = memory.runMemoryMatrix({ scope: "ours" });
const expected = fixtures.datasets.map((d) => d.name);
for (const op of ["parse", "stringify"]) {
  const found = results.filter((r) => r.candidate === "lightning-yaml" && r.op === op).map((r) => r.dataset);
  assert.deepEqual(found, expected, `Lightning YAML ${op} memory rows are missing or reordered`);
}
for (const row of results) {
  assert.ok(Number.isFinite(row.peakRssBytes) && row.peakRssBytes > 0, `invalid RSS: ${JSON.stringify(row)}`);
  assert.ok(Number.isFinite(row.heapDeltaBytes), `invalid heap delta: ${JSON.stringify(row)}`);
}
const writeReportProgress = console.log;
console.log = (...args) => console.error(...args);
try {
  memory.emitMemoryYaml("ours", results);
} finally {
  console.log = writeReportProgress;
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), root, iterations, results }));
