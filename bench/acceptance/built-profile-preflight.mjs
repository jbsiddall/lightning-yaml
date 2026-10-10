#!/usr/bin/env node
// Semantic routing check for the built ESM/CJS facades used by warm profiles.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sameGraph } from "./graph-equal.mjs";
import { facadeDatasets } from "./profile-workloads.mjs";

const [baseArg, candidateArg] = process.argv.slice(2);
assert.ok(baseArg && candidateArg, "usage: built-profile-preflight.mjs BASELINE_ROOT CANDIDATE_ROOT");
const roots = [resolve(baseArg), resolve(candidateArg)];
const loaded = await Promise.all(roots.map(async (root) => {
  const esm = await import(pathToFileURL(join(root, "dist/index.js")).href);
  const requireFromRoot = createRequire(join(root, "package.json"));
  const cjs = requireFromRoot("./dist/index.cjs");
  const source = await import(pathToFileURL(join(root, "src/index.ts")).href);
  const fixtures = await import(pathToFileURL(join(root, "bench/fixtures/datasets.ts")).href);
  return { esm, cjs, source, fixtures };
}));
function equal(label, a, b) { assert.ok(sameGraph(a, b), `built facade mismatch: ${label}`); }

for (const name of facadeDatasets) {
  const [base, candidate] = loaded;
  const baseData = base.fixtures.datasets.find((d) => d.name === name);
  const candidateData = candidate.fixtures.datasets.find((d) => d.name === name);
  assert.ok(baseData && candidateData, `built profile fixture missing: ${name}`);
  const baseText = base.fixtures.loadFixtureText(baseData);
  const candidateText = candidate.fixtures.loadFixtureText(candidateData);
  assert.equal(candidateText, baseText, `built profile input bytes differ: ${name}`);
  const sourceValue = base.fixtures.loadFixtureValue(baseData);
  equal(`${name}: source value`, sourceValue, candidate.fixtures.loadFixtureValue(candidateData));
  for (const format of ["esm", "cjs"]) {
    const baseApi = base[format], candidateApi = candidate[format];
    const baseParsed = baseApi.parse(baseText), candidateParsed = candidateApi.parse(candidateText);
    equal(`${format} parse ${name}`, baseParsed, candidateParsed);
    equal(`${format} baseline built/source parse ${name}`, base.source.parse(baseText), baseParsed);
    equal(`${format} candidate built/source parse ${name}`, candidate.source.parse(candidateText), candidateParsed);
    const baseEmitted = baseApi.stringify(sourceValue), candidateEmitted = candidateApi.stringify(sourceValue);
    assert.equal(candidateEmitted, baseEmitted, `${format} stringify text differs: ${name}`);
    assert.equal(baseEmitted, base.source.stringify(sourceValue), `baseline ${format} stringify differs from source facade: ${name}`);
    assert.equal(candidateEmitted, candidate.source.stringify(sourceValue), `candidate ${format} stringify differs from source facade: ${name}`);
    equal(`${format} stringify roundtrip baseline ${name}`, sourceValue, baseApi.parse(baseEmitted, { strict: true }));
    equal(`${format} stringify roundtrip candidate ${name}`, sourceValue, candidateApi.parse(candidateEmitted, { strict: true }));
  }
}
console.log(JSON.stringify({ ok: true, roots, formats: ["esm", "cjs"], fixtures: facadeDatasets }));
