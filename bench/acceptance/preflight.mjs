#!/usr/bin/env node
// Semantic and fixture preflight for the paired full-library benchmark.
// Run with: node --import tsx bench/acceptance/preflight.mjs BASELINE CANDIDATE

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { sameGraph } from "./graph-equal.mjs";
import { diagnosticInputs } from "./profile-workloads.mjs";

const [baselineArg, candidateArg] = process.argv.slice(2);
if (!baselineArg || !candidateArg) {
  throw new Error("usage: preflight.mjs BASELINE_ROOT CANDIDATE_ROOT");
}
const roots = [resolve(baselineArg), resolve(candidateArg)];

async function load(root, rel) {
  return import(pathToFileURL(join(root, rel)).href);
}

const [baseApi, candidateApi] = await Promise.all(roots.map((root) => load(root, "src/index.ts")));
const [baseYamlCompat, candidateYamlCompat] = await Promise.all(roots.map((root) => load(root, "src/yaml-compat.ts")));
const [baseJsCompat, candidateJsCompat] = await Promise.all(roots.map((root) => load(root, "src/js-yaml-compat.ts")));
const fixtureApi = await load(roots[0], "bench/fixtures/datasets.ts");
const { datasets, loadFixtureText, loadFixtureValue } = fixtureApi;
let casesChecked = 0;

function equal(label, a, b) {
  assert.ok(sameGraph(a, b), `semantic preflight mismatch: ${label}`);
}

for (const dataset of datasets) {
  const text = loadFixtureText(dataset);
  const baseText = readFileSync(join(roots[0], "bench/fixtures/data", `${dataset.name}${dataset.category === "json" ? ".json" : ".yaml"}`));
  const candidateFixture = join(roots[1], "bench/fixtures/data", `${dataset.name}${dataset.category === "json" ? ".json" : ".yaml"}`);
  const candidateText = readFileSync(existsSync(candidateFixture) ? candidateFixture : join(roots[0], "bench/fixtures/data", `${dataset.name}${dataset.category === "json" ? ".json" : ".yaml"}`));
  assert.deepEqual(candidateText, baseText, `fixture bytes differ for ${dataset.name}`);
  assert.equal(text, baseText.toString("utf8"), `fixture loader changed bytes for ${dataset.name}`);

  const baseParsed = baseApi.parse(text);
  const candidateParsed = candidateApi.parse(text);
  equal(`${dataset.name}: parse`, baseParsed, candidateParsed);
  equal(`${dataset.name}: strict parse`, baseApi.parse(text, { strict: true }), candidateApi.parse(text, { strict: true }));
  equal(`${dataset.name}: parseAll`, baseApi.parseAll(text), candidateApi.parseAll(text));
  equal(`${dataset.name}: strict parseAll`, baseApi.parseAll(text, { strict: true }), candidateApi.parseAll(text, { strict: true }));

  const sourceValue = loadFixtureValue(dataset);
  equal(`${dataset.name}: stringify input`, sourceValue, baseParsed);
  equal(`${dataset.name}: stringify input candidate`, sourceValue, candidateParsed);
  for (const [label, api] of [["baseline", baseApi], ["candidate", candidateApi]]) {
    const emitted = api.stringify(sourceValue);
    assert.equal(typeof emitted, "string", `${dataset.name}: ${label} stringify did not return text`);
    equal(`${dataset.name}: ${label} stringify -> baseline parse`, sourceValue, baseApi.parse(emitted, { strict: true }));
    equal(`${dataset.name}: ${label} stringify -> candidate parse`, sourceValue, candidateApi.parse(emitted, { strict: true }));
  }
  casesChecked++;
}

for (const { name, text, options } of diagnosticInputs) {
  equal(`diagnostic ${name}`, baseApi.parse(text, options), candidateApi.parse(text, options));
}

// Exercise facade costs and option paths before they enter the representative
// profile benchmark. The fixtures are deliberately plain/core-valid here so
// the independent compatibility shims can all consume the same input.
for (const name of ["small-records", "medium-records", "yaml-plain-medium-records"]) {
  const dataset = datasets.find((d) => d.name === name);
  assert.ok(dataset, `missing profile fixture ${name}`);
  const text = loadFixtureText(dataset);
  const expected = baseApi.parse(text);
  const optionCalls = [
    ["internStrings", { optimizations: { internStrings: true } }],
    ["smallKeyCache", { optimizations: { keyCacheMaxKb: 1 } }],
  ];
  for (const [label, options] of optionCalls) {
    equal(`${name}: ${label}`, expected, candidateApi.parse(text, options));
  }
  equal(`${name}: yaml compat parse`, expected, candidateYamlCompat.parse(text));
  equal(`${name}: yaml compat parseAllDocuments`, [expected], candidateYamlCompat.parseAllDocuments(text).map((doc) => doc.toJS()));
  equal(`${name}: js-yaml compat load`, expected, candidateJsCompat.load(text));
  equal(`${name}: js-yaml compat loadAll`, [expected], candidateJsCompat.loadAll(text));
  const outputCases = [
    ["native", candidateApi.stringify(expected)],
    ["yaml compat", candidateYamlCompat.stringify(expected)],
    ["js-yaml compat", candidateJsCompat.dump(expected)],
  ];
  for (const [label, emitted] of outputCases) {
    assert.equal(typeof emitted, "string", `${name}: ${label} did not return text`);
    equal(`${name}: ${label} stringify round-trip`, expected, candidateApi.parse(emitted, { strict: true }));
  }
}

const stream = "---\nfirst: 1\n---\nsecond: [true, null]\n";
equal("multi-document parseAll", baseApi.parseAll(stream), candidateApi.parseAll(stream));
equal("multi-document strict parseAll", baseApi.parseAll(stream, { strict: true }), candidateApi.parseAll(stream, { strict: true }));
equal("multi-document interned parseAll", baseApi.parseAll(stream), candidateApi.parseAll(stream, { optimizations: { internStrings: true } }));

console.log(JSON.stringify({ ok: true, roots, fixtureCount: casesChecked, diagnosticProfiles: diagnosticInputs.length, profiles: 9, streamProfiles: 3 }));
