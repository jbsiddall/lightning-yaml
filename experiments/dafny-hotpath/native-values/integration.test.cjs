'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { audit } = require('./check-output.cjs');
const { loadKernel, loadNativeApi } = require('./load.cjs');
const { createHeap, NativeValues: host } = require('./dist/runtime.js');

const api = loadNativeApi();
const demo = api.demo();
assert.equal(Object.getPrototypeOf(demo), Object.prototype);
assert.equal(Object.getPrototypeOf(demo.child), Object.prototype);
assert.equal(Object.getPrototypeOf(demo.list), Array.prototype);
assert.deepEqual(demo.child, {number: 7, text: 'native text', boolean: true});
assert.equal(demo.list[0], demo.child);
assert.equal(demo.list[1], demo.child);
assert.equal(demo.self, demo);
assert.equal(demo.null, null);
assert.equal(Object.hasOwn(demo, 'undefined'), true);
assert.equal(demo.undefined, undefined);
for (const count of [0, 1, 32, 4096]) {
  const numbers = api.numbers(count);
  assert.equal(Object.getPrototypeOf(numbers), Array.prototype);
  for (let i = 0; i < count; i++) assert.equal(numbers[i], i);
}
const kernel = loadKernel();
assert.equal(Object.getOwnPropertyDescriptor(kernel, 'nullValue').writable, false);
assert.equal(Object.getOwnPropertyDescriptor(kernel, 'undefinedValue').writable, false);
const heap = createHeap();
const graph = kernel.Demo(heap);
assert.equal(kernel.ObjectKeyCount(heap, graph), 5);
const keys = host.objectKeys(heap, graph);
assert.equal(Object.getPrototypeOf(keys), Array.prototype);
assert.deepEqual(keys, ['child', 'list', 'null', 'undefined', 'self']);

// Mutating actual emitted code verifies that the build guard covers this ABI.
const scratch = path.join(__dirname, 'dist/mutations');
fs.mkdirSync(scratch, { recursive: true });
const emitted = fs.readFileSync(path.join(__dirname, 'generated.js'), 'utf8');
const source = ts.createSourceFile('kernel.js', emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let insertion;
function findDemo(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'Demo') insertion = node.body.getStart(source) + 1;
  ts.forEachChild(node, findDemo);
}
findDemo(source);
assert.equal(typeof insertion, 'number');
const mutated = emitted.slice(0, insertion) + '\nnew BigNumber(1);\n' + emitted.slice(insertion);
const filename = path.join(scratch, 'boxed-kernel.js');
fs.writeFileSync(filename, mutated);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'guard.json'), 'utf8'));
const negative = audit({...manifest, generated: [{file: filename, roots: ['NativeValues.__default.Demo']}]}, __dirname);
assert.equal(negative.ok, false);
assert.match(negative.diagnostics.join('\n'), /BigNumber/);
const declarations = path.join(scratch, 'unsafe.d.ts');
fs.writeFileSync(declarations, 'export declare function parse(s: string): any;\n');
const unsafe = audit({wholeFiles: [declarations]}, __dirname);
assert.equal(unsafe.ok, false);
assert.match(unsafe.diagnostics.join('\n'), /explicit TypeScript any/);
console.log('Generated integration: native graph/array identity, scalar values, key count and emitted-code regressions passed');
