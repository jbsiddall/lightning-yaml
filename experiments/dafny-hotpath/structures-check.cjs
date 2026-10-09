const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

function load(filename, entry) {
  const full = path.join(__dirname, filename);
  const loaded = new Module(full, module);
  loaded.filename = full;
  loaded.paths = Module._nodeModulePaths(__dirname);
  loaded._compile(fs.readFileSync(full, 'utf8') +
    `\nmodule.exports = {entry: ${entry}, runtime: _dafny};\n`, full);
  return loaded.exports;
}
const {entry: s, runtime: rt} = load('Structures.js', 'Structures.__default');
const {entry: raw} = load('OpaqueValue.js', 'Raw.__default');

let leafCalls = 0, branchCalls = 0;
s.leaf = value => { leafCalls++; return {value}; };
s.branch = child => { branchCalls++; return {child, items: [child], label: 'node'}; };
s.isLeaf = v => Object.hasOwn(v, 'value');
s.child = v => v.child;
raw.number = value => value;
raw.array = (a, b) => [a, b];
raw.sameValue = Object.is;

const nested = s.Nested();
assert.equal(nested.is_Object, true);
assert(nested.fields instanceof rt.Map);
const items = nested.fields.get('items');
assert.equal(items.is_List, true);
assert(items.items instanceof rt.Seq);
assert.notEqual(Object.getPrototypeOf(items.items), Array.prototype);
assert.equal(nested.fields.get('child'), items.items[0]);
assert.equal(nested.fields.get('child').fields.get('value').value, 7);

for (const n of [0, 1, 32, 512]) {
  const a = s.PlainArray(n);
  assert.equal(Object.getPrototypeOf(a), Array.prototype);
  assert.deepEqual(a, Array.from({length: n}, (_, i) => i));
  assert.deepEqual(s.InitializedArray(n), a);
  assert.equal(s.WrappedArray(a), a);
  assert.deepEqual(Array.from(s.AppendSequence(n)), a);
}

let copiedPrefixElements = 0;
const concat = rt.Seq.Concat;
rt.Seq.Concat = (a, b) => { copiedPrefixElements += a.length; return concat(a, b); };
s.AppendSequence(256);
rt.Seq.Concat = concat;
assert.equal(copiedPrefixElements, 256 * 255 / 2);

let copiedMapEntries = 0, keyComparisons = 0;
const update = rt.Map.prototype.update;
const areEqual = rt.areEqual;
rt.Map.prototype.update = function(k, v) { copiedMapEntries += this.length; return update.call(this, k, v); };
rt.areEqual = (a, b) => { keyComparisons++; return areEqual(a, b); };
const keys = rt.Seq.of(...Array.from({length: 256}, (_, i) => 'key' + i));
const map = s.BuildMap(keys);
assert.equal(copiedMapEntries, 256 * 255 / 2);
assert.equal(keyComparisons, 256 * 255 / 2);
keyComparisons = 0;
assert.equal(map.get('key255'), 255);
assert.equal(keyComparisons, 256);
rt.Map.prototype.update = update;
rt.areEqual = areEqual;

for (const depth of [0, 1, 32, 512, 20000]) {
  leafCalls = branchCalls = 0;
  const native = s.NativeTreeIterative(depth);
  assert.equal(leafCalls, 1);
  assert.equal(branchCalls, depth);
  assert.equal(s.ReadNativeTree(native), depth);
  assert.equal(s.Identity(native), native);
  let cursor = native;
  for (let i = 0; i < depth; i++) {
    assert.equal(Object.getPrototypeOf(cursor), Object.prototype);
    assert.equal(Object.getPrototypeOf(cursor.items), Array.prototype);
    assert.equal(cursor.items.length, 1);
    assert.equal(cursor.items[0], cursor.child);
    assert.equal(cursor.label, 'node');
    cursor = cursor.child;
  }
  assert.deepEqual(cursor, {value: 7});
}
const made = raw.Make();
assert.deepEqual(made, [7, 7]);
assert.equal(Object.getPrototypeOf(made), Array.prototype);
const cycle = {items: []};
cycle.items.push(cycle);
for (const value of [null, undefined, true, false, 7, -0, NaN, '😀\ud800', made, cycle])
  assert(Object.is(raw.Identity(value), value));
assert.throws(() => raw.BuiltinEquality(cycle, cycle), TypeError);
assert.equal(raw.SameValue(cycle, cycle), true);
assert.equal(raw.SameValue(cycle, {}), false);
assert.equal(raw.SameValue(NaN, NaN), true);
assert.equal(raw.SameValue(0, -0), false);

console.log(JSON.stringify({node: process.version, dafny: '4.11.0',
  result: 'passed', plainArray: 'Array.prototype; numeric elements unboxed',
  erasableArrayBox: 'same array reference', defaultTree: 'tagged datatype + Seq + pair-array Map',
  appendSequence256: {copiedPrefixElements}, mapBuild256: {copiedMapEntries, uniqueKeyComparisons: copiedMapEntries},
  lastMapLookup256: {keyComparisons}, nativeTreeMaxDepth: 20000,
  nativeTree: 'plain objects/arrays; child alias preserved; no tree conversion',
  opaqueIdentity: 'preserves primitives, null, undefined, object identity and cycles',
  opaqueEquality: 'builtin equality rejects plain objects; specified Object.is extern works',
  proofScope: 'abstract unary tree; extern allocator/reader contracts assumed; no cyclic graph semantic proof',
  timing: 'not a performance benchmark; runtime representations and operation counts only'}));
