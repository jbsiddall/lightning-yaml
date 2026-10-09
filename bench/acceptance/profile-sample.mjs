#!/usr/bin/env node
// Facade/option microprofiles, in addition to the 13 × 2 standard matrix.
// These are diagnostic acceptance rows, not substitutes for the full matrix.

import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { bench, do_not_optimize, group, run } from "mitata";

const root = resolve(process.argv[2] ?? process.cwd());
const [api, yamlCompat, jsCompat, fixtures] = await Promise.all([
  import(pathToFileURL(join(root, "src/index.ts")).href),
  import(pathToFileURL(join(root, "src/yaml-compat.ts")).href),
  import(pathToFileURL(join(root, "src/js-yaml-compat.ts")).href),
  import(pathToFileURL(join(root, "bench/fixtures/datasets.ts")).href),
]);
const selectedNames = ["small-records", "medium-records", "yaml-plain-medium-records", "yaml-rich-medium"];
const selected = selectedNames.map((name) => {
  const dataset = fixtures.datasets.find((d) => d.name === name);
  assert.ok(dataset, `profile fixture not found: ${name}`);
  return { dataset, text: fixtures.loadFixtureText(dataset), value: fixtures.loadFixtureValue(dataset) };
});
const records = [];

function add(profile, dataset, fn) {
  const workload = `${profile} · ${dataset.name}`;
  records.push({ profile, workload });
  group(workload, () => bench(profile, () => do_not_optimize(fn())));
}

for (const { dataset, text } of selected) {
  add("native.parse", dataset, () => api.parse(text));
  add("native.parseAll", dataset, () => api.parseAll(text));
  add("native.strictParse", dataset, () => api.parse(text, { strict: true }));
  add("native.strictParseAll", dataset, () => api.parseAll(text, { strict: true }));
}

for (const name of ["medium-records", "yaml-plain-medium-records"]) {
  const { dataset, text, value } = selected.find((x) => x.dataset.name === name);
  add("native.internStrings", dataset, () => api.parse(text, { optimizations: { internStrings: true } }));
  add("native.smallKeyCache", dataset, () => api.parse(text, { optimizations: { keyCacheMaxKb: 1 } }));
  add("yamlCompat.parse", dataset, () => yamlCompat.parse(text));
  add("yamlCompat.parseAllDocuments", dataset, () => yamlCompat.parseAllDocuments(text).map((doc) => doc.toJS()));
  add("jsYamlCompat.load", dataset, () => jsCompat.load(text));
  add("jsYamlCompat.loadAll", dataset, () => jsCompat.loadAll(text));
  add("native.stringify", dataset, () => api.stringify(value));
  add("yamlCompat.stringify", dataset, () => yamlCompat.stringify(value));
  add("jsYamlCompat.dump", dataset, () => jsCompat.dump(value));
}

const trial = await run({ format: "quiet", throw: true });
const rows = [];
for (const result of trial.benchmarks) {
  const label = trial.layout[result.group]?.name;
  assert.ok(label, `mitata returned an unknown profile group for ${result.alias}`);
  const sep = label.indexOf(" · ");
  assert.notEqual(sep, -1, `invalid profile label ${label}`);
  const run = result.runs?.[0];
  assert.ok(run?.stats, `missing timing for ${label}`);
  rows.push({ workload: label.slice(sep + 3), profile: result.alias, ...run.stats });
}
assert.equal(rows.length, records.length, "a profile row was omitted");
for (const row of rows) {
  for (const field of ["avg", "min", "p75", "p99", "max"]) {
    assert.ok(Number.isFinite(row[field]) && row[field] >= 0, `invalid ${field}: ${JSON.stringify(row)}`);
  }
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), root, context: trial.context, rows }));
