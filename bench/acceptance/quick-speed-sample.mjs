#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { diagnosticInputs } from "./profile-workloads.mjs";

const [rootArg, roundArg = "0"] = process.argv.slice(2);
if (!rootArg) throw new Error("usage: quick-speed-sample.mjs ROOT");
const root = resolve(rootArg);
const [{ candidateByName }, { datasetByName, loadFixtureText, loadFixtureValue }] = await Promise.all([
  import(pathToFileURL(join(root, "bench/candidates.ts"))),
  import(pathToFileURL(join(root, "bench/fixtures/datasets.ts"))),
]);
const datasets = ["medium-records", "yaml-plain-medium-records", "yaml-rich-medium"];
const rows = [
  ...datasets.flatMap((dataset) => ["parse", "stringify"].map((op) => ({ key: `${op} · ${dataset}`, dataset, op }))),
  { key: "parse options · yaml-plain-medium-records", dataset: "yaml-plain-medium-records", op: "parse-options" },
  { key: "diagnostic.parse · escaped-longquotes", dataset: "escaped-longquotes", op: "diagnostic" },
  { key: "diagnostic.parse · unescaped-longquotes", dataset: "unescaped-longquotes", op: "diagnostic" },
];
const round = Number(roundArg);
const orderedRows = [...rows.slice(round % rows.length), ...rows.slice(0, round % rows.length)];
const candidate = candidateByName("lightning-yaml");
const { parse: parseWithOptions } = await import(pathToFileURL(join(root, "src/index.ts")));
const median = (xs) => { const sorted = [...xs].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const result = {};
let sink;
for (const row of orderedRows) {
  const ds = row.op === "diagnostic" ? null : datasetByName(row.dataset);
  const input = row.op === "diagnostic"
    ? diagnosticInputs.find(({ name }) => name === row.dataset).text
    : row.op === "stringify" ? loadFixtureValue(ds) : loadFixtureText(ds);
  const options = { strict: true, optimizations: { internStrings: true, keyCacheMaxKb: 1 } };
  const call = () => row.op === "stringify" ? candidate.stringify(input)
    : row.op === "parse-options" ? parseWithOptions(input, options)
      : candidate.parse(input, ds?.category);
  let warmupCalls = 0;
  const warmupStart = process.hrtime.bigint();
  do {
    sink = call();
    warmupCalls++;
  } while (warmupCalls < 16 || process.hrtime.bigint() - warmupStart < 250_000_000n);
  const warmupElapsedNs = Number(process.hrtime.bigint() - warmupStart);
  const samples = [];
  const counts = [];
  const elapsedBatches = [];
  for (let batch = 0; batch < 5; batch++) {
    const start = process.hrtime.bigint();
    let count = 0;
    do {
      sink = call();
      count++;
    } while (process.hrtime.bigint() - start < 80_000_000n);
    const elapsed = Number(process.hrtime.bigint() - start);
    samples.push(elapsed / count);
    counts.push(count);
    elapsedBatches.push(elapsed);
  }
  result[row.key] = { warmupCalls, warmupElapsedNs, batchCalls: counts, batchElapsedNs: elapsedBatches, nsPerCall: samples, medianNsPerCall: median(samples) };
}
if (sink === Symbol.for("never")) process.stderr.write("unreachable");
process.stdout.write(JSON.stringify({ rows: result }) + "\n");
