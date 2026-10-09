'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { discoverCharCodeSites, nativeIdentityInventory } = require('./dafny-shape-transform.cjs');

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

test('shape audit rejects an indexed code-unit site outside the audited string receivers', () => {
  const source = ts.createSourceFile('bad.js',
    'const Engine = class Engine { Parse() { return bytes[0].charCodeAt(0); } };',
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.throws(() => discoverCharCodeSites(source), /unsupported indexed-string charCodeAt receiver/);
});
