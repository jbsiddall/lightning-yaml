#!/usr/bin/env node
// Warm parse/stringify timings through built public ESM and CJS entry points.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { bench, do_not_optimize, group, run } from "mitata";
import { assertExactRows } from "./rowset.mjs";
import { builtProfileKeys, facadeDatasets } from "./profile-workloads.mjs";

const root = resolve(process.argv[2] ?? process.cwd());
const esm = await import(pathToFileURL(join(root, "dist/index.js")).href);
const requireFromRoot = createRequire(join(root, "package.json"));
const cjs = requireFromRoot("./dist/index.cjs");
const fixtures = await import(pathToFileURL(join(root, "bench/fixtures/datasets.ts")).href);
const records = [];

for (const format of ["esm", "cjs"]) {
  const api = format === "esm" ? esm : cjs;
  for (const name of facadeDatasets) {
    const dataset = fixtures.datasets.find((d) => d.name === name);
    assert.ok(dataset, `built facade fixture missing: ${name}`);
    const text = fixtures.loadFixtureText(dataset);
    const value = fixtures.loadFixtureValue(dataset);
    const parse = () => api.parse(text);
    const stringify = () => api.stringify(value);
    // Keep module loading and one-time setup out of the measured operation.
    for (let i = 0; i < 16; i++) { do_not_optimize(parse()); do_not_optimize(stringify()); }
    for (const [operation, fn] of [["parse", parse], ["stringify", stringify]]) {
      const workload = `built.${format}.${operation} · ${name}`;
      records.push(workload);
      group(workload, () => bench(`built.${format}.${operation}`, () => do_not_optimize(fn())));
    }
  }
}

const trial = await run({ format: "quiet", throw: true });
const rows = [];
for (const result of trial.benchmarks) {
  const label = trial.layout[result.group]?.name;
  assert.ok(label, `mitata returned an unknown built profile group for ${result.alias}`);
  const sep = label.indexOf(" · ");
  assert.notEqual(sep, -1, `invalid built profile label ${label}`);
  const run = result.runs?.[0];
  assert.ok(run?.stats, `missing timing for ${label}`);
  rows.push({ workload: label.slice(sep + 3), profile: result.alias, ...run.stats });
}
assertExactRows(records, builtProfileKeys(), "built profile schedule");
assertExactRows(rows.map((r) => `${r.profile} · ${r.workload}`), builtProfileKeys(), "built profile results");
for (const row of rows) {
  for (const field of ["avg", "min", "p75", "p99", "max"]) {
    assert.ok(Number.isFinite(row[field]) && row[field] >= 0, `invalid ${field}: ${JSON.stringify(row)}`);
  }
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), root, warmupCallsPerOperation: 16, context: trial.context, rows }));
