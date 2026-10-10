#!/usr/bin/env node
// One fresh-process import sample. The paired runner starts a new Node process
// for every sample, so the module cache is cold by construction.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const [rootArg, format] = process.argv.slice(2);
assert.ok(rootArg && (format === "esm" || format === "cjs"), "usage: cold-import.mjs ROOT esm|cjs");
const root = resolve(rootArg);
const started = process.hrtime.bigint();
let api;
if (format === "esm") {
  api = await import(pathToFileURL(join(root, "dist/index.js")).href);
} else {
  const requireFromRoot = createRequire(join(root, "package.json"));
  api = requireFromRoot("./dist/index.cjs");
}
const importNs = Number(process.hrtime.bigint() - started);
assert.equal(typeof api.parse, "function");
assert.equal(typeof api.stringify, "function");
const parsed = api.parse("a: [1, true]");
assert.deepEqual(parsed, { a: [1, true] });
const emitted = api.stringify(parsed);
assert.equal(typeof emitted, "string");
console.log(JSON.stringify({ root, format, importNs, node: process.version, smokeBytes: Buffer.byteLength(emitted) }));
