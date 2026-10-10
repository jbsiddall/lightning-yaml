'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { discoverCharCodeSites, discoverInstanceFields, discoverSyntheticTempSites, inlineSyntheticTemps, mangleInstanceFields, nativeIdentityInventory } = require('./dafny-shape-transform.cjs');

const nativePath = path.resolve(__dirname, '../src/dafny/native.ts');
const native = fs.readFileSync(nativePath, 'utf8');

test('shape audit rejects a Native identity helper that no longer returns its argument', () => {
  const changed = native.replace('stringValue(s: string): string { return s; }',
    'stringValue(s: string): string { return s + ""; }');
  assert.notEqual(changed, native);
  assert.throws(() => nativeIdentityInventory(changed), /identity cast/);
});

test('shape audit rejects a Native arithmetic helper with changed grouping', () => {
  const changed = native.replace('(accumulator as number) * radix + digit',
    '(accumulator as number) * (radix + digit)');
  assert.notEqual(changed, native);
  assert.throws(() => nativeIdentityInventory(changed), /audited primitive expression/);
});

test('shape audit rejects changed native array access semantics', () => {
  const changed = native.replace('arrayGet(array: unknown, i: number): unknown { return (array as unknown[])[i]; }',
    'arrayGet(array: unknown, i: number): unknown { return (array as unknown[]).at(i); }');
  assert.notEqual(changed, native);
  assert.throws(() => nativeIdentityInventory(changed), /Native\.arrayGet body no longer matches/);
});

test('shape audit rejects an indexed code-unit site outside the audited string receivers', () => {
  const source = ts.createSourceFile('bad.js',
    'const Engine = class Engine { Parse() { return bytes[0].charCodeAt(0); } };',
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.throws(() => discoverCharCodeSites(source), /unsupported indexed-string charCodeAt receiver/);
});

test('private field shortening keeps diagnostic fields and counts generated per-instance sites', () => {
  const generated = `class Engine {
    constructor() { this.secretState = 0; this.pos = 0; this.len = 0; this.src = ''; this.lineStart = 0; }
    read() { return this.secretState + this.pos; }
  }
  class Writer {
    constructor() { this.writerState = 0; }
    read() { return this.writerState; }
  }`;
  const source = ts.createSourceFile('field-fixture.js', generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const { fieldMaps, fieldCounts } = discoverInstanceFields(source);
  for (const name of ['pos', 'len', 'src', 'lineStart']) assert.equal(Object.hasOwn(fieldMaps.Engine, name), false);
  assert.ok(fieldMaps.Engine.secretState);
  const transformed = mangleInstanceFields(generated, fieldMaps, fieldCounts);
  assert.equal(transformed.accessCounts.Engine.secretState, fieldCounts.Engine.secretState);
  assert.match(transformed.text, /this\._f/);
  assert.match(transformed.text, /this\.pos/);
});

test('private field shortening rejects receiver escapes and computed self keys', () => {
  const changed = 'class Engine { constructor() { this.secret = 0; } read() { return this.secret; } } class Writer { constructor() { this.writerState = 0; } } const leak = e.secret;';
  const source = ts.createSourceFile('field-escape.js', changed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.throws(() => discoverInstanceFields(source), /unsupported escaped Engine.secret/);
  const computed = 'class Engine { constructor() { this.secret = 0; } read() { return this["secret"]; } } class Writer { constructor() { this.writerState = 0; } }';
  const computedSource = ts.createSourceFile('field-computed.js', computed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.throws(() => discoverInstanceFields(computedSource), /unsupported dynamic Engine.secret/);
});

test('synthetic Dafny output temporaries inline only at pinned adjacent sites', () => {
  const generated = `class Engine {
    ParseAll() {
      let _out0;
      _out0 = this.ParseOne();
      this.result = _out0;
      let _out1;
      _out1 = 4;
      value = _out1;
    }
  }
  class Writer { Stringify() { return ''; } }`;
  const source = ts.createSourceFile('temporary-fixture.js', generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const sites = discoverSyntheticTempSites(source);
  const total = Object.values(sites).reduce((n, item) => n + item.identifier + item['self-property'], 0);
  assert.equal(total, 2);
  const result = inlineSyntheticTemps(generated, sites);
  assert.equal(result.text.length < generated.length, true);
  assert.equal(result.siteCounts['Engine.ParseAll'].identifier, 1);
  assert.equal(result.siteCounts['Engine.ParseAll']['self-property'], 1);
});

test('synthetic output temporary audit rejects escaping closures and complex assignment targets', () => {
  const unsupported = 'class Engine { m() { let _out0; _out0 = make(); foreign.key = _out0; } } class Writer { m() { let x; x = 0; } }';
  assert.throws(() => discoverSyntheticTempSites(ts.createSourceFile('bad-target.js', unsupported, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)), /unsupported synthetic output target/);
  const escaped = 'class Engine { m() { let _out0; _out0 = make(); value = _out0; const f = () => _out0; } } class Writer { m() { let x; x = 0; } }';
  assert.throws(() => discoverSyntheticTempSites(ts.createSourceFile('closure.js', escaped, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)), /escapes its generated method/);
  const extraRead = 'class Engine { m() { let _out0; _out0 = make(); value = _out0; other = _out0; } } class Writer { m() { let x; x = 0; } }';
  assert.throws(() => discoverSyntheticTempSites(ts.createSourceFile('extra-read.js', extraRead, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)), /unpinned read or write/);
});
