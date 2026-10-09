#!/usr/bin/env node
// Raw-precision companion to bench/speed/emit.ts. It reuses that matrix's
// dataset loaders and candidate registry, but preserves unrounded mitata stats.
// This script measures only JSON + this checkout's Lightning YAML candidate.

import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { bench, do_not_optimize, group, run } from "mitata";
import { assertExactRows } from "./rowset.mjs";

const root = resolve(process.argv[2] ?? process.cwd());
const [candidateModule, fixtureModule] = await Promise.all([
  import(pathToFileURL(join(root, "bench/candidates.ts")).href),
  import(pathToFileURL(join(root, "bench/fixtures/datasets.ts")).href),
]);
const api = await import(pathToFileURL(join(root, "src/index.ts")).href);
const { datasets, loadFixtureText, loadFixtureValue } = fixtureModule;
const json = candidateModule.candidateByName("JSON");
const lightning = candidateModule.candidateByName("lightning-yaml");
assert.equal(typeof api.parse, "function", "public parse export missing");
assert.equal(typeof api.parseAll, "function", "public parseAll export missing");
assert.equal(typeof api.stringify, "function", "public stringify export missing");
assert.equal(typeof json.parse, "function");
assert.equal(typeof json.stringify, "function");
assert.equal(typeof lightning.parse, "function");
assert.equal(typeof lightning.stringify, "function");

for (const dataset of datasets) {
  for (const op of ["parse", "stringify"]) {
    const expected = [lightning];
    if (candidateModule.candidateAppliesTo(json, dataset, op)) expected.unshift(json);
    const input = op === "parse" ? loadFixtureText(dataset) : loadFixtureValue(dataset);
    group(`${op} · ${dataset.name}`, () => {
      for (const candidate of expected) {
        if (op === "parse") {
          bench(candidate.name, () => do_not_optimize(candidate.parse(input, dataset.category)));
        } else {
          bench(candidate.name, () => do_not_optimize(candidate.stringify(input)));
        }
      }
    });
  }
}

const trial = await run({ format: "quiet", throw: true });
const rows = { parse: [], stringify: [] };
for (const result of trial.benchmarks) {
  const label = trial.layout[result.group]?.name;
  assert.ok(label, `mitata returned an unknown group for ${result.alias}`);
  const sep = label.indexOf(" · ");
  assert.notEqual(sep, -1, `unexpected group label ${label}`);
  const op = label.slice(0, sep);
  const workload = label.slice(sep + 3);
  assert.ok(op === "parse" || op === "stringify", `unexpected operation ${op}`);
  const run = result.runs?.[0];
  assert.ok(run?.stats, `missing timing for ${op}/${workload}/${result.alias}`);
  rows[op].push({ workload, library: result.alias, ...run.stats });
}

const expectedNames = datasets.map((d) => d.name);
for (const op of ["parse", "stringify"]) {
  const found = rows[op].filter((r) => r.library === "lightning-yaml").map((r) => r.workload);
  assertExactRows(found, expectedNames, `Lightning YAML ${op}`);
  for (const row of rows[op]) {
    for (const field of ["avg", "min", "p75", "p99", "max"]) {
      assert.ok(Number.isFinite(row[field]) && row[field] >= 0, `invalid ${field} for ${op}/${row.workload}/${row.library}`);
    }
  }
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  root,
  context: trial.context,
  rows,
}));
