'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { audit } = require('./check-dafny-output.cjs');

const base = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dafny-output-guard.json'), 'utf8'));
const generatedPath = path.resolve(base, manifest.generated[0].file);
const nativePath = path.resolve(base, '../src/dafny/native.ts');
const declarationPath = path.resolve(base, '../src/dafny/generated/engine.d.ts');
const config = {
  generated: [{ file: manifest.generated[0].file, roots: ['DafnyCore.Engine.ParseSingle'] }],
  wholeFiles: ['../src/dafny/native.ts', '../src/errors.ts'],
  allowedCalls: manifest.allowedCalls,
  allowedConstructors: manifest.allowedConstructors,
  sourceSha256: manifest.sourceSha256,
  shapeManifest: manifest.shapeManifest,
};

function override(file, transform) {
  const original = fs.readFileSync(file, 'utf8');
  const changed = transform(original);
  assert.notEqual(changed, original, `mutation did not alter ${file}`);
  return { [file]: changed };
}
function rejects(fileOverrides, pattern, additional = {}) {
  const result = audit({ ...config, ...additional }, base, fileOverrides);
  assert.equal(result.ok, false, 'guard accepted a deliberately invalid mutation');
  assert.match(result.diagnostics.join('\n'), pattern);
}

test('output guard rejects a reachable Dafny BigNumber dependency', () => {
  rejects(override(generatedPath, source => source.replace(
    /(^\s*ParseSingle\(\) \{\n)/m,
    '$1            const forbidden = new BigNumber(1);\n',
  )), /BigNumber|BigInt/);
});

test('output guard rejects a changed native UTF16 primitive', () => {
  rejects(override(nativePath, source => source.replace(
    'return s.charCodeAt(i);',
    'return s.charAt(i).charCodeAt(0);',
  )), /trusted boundary source digest changed/);
});

test('output guard rejects a changed native numeric primitive', () => {
  rejects(override(nativePath, source => source.replace(
    'Math.floor(a / b)',
    'Math.trunc(a / b)',
  )), /trusted boundary source digest changed/);
});

test('output guard rejects an old-core fallback import', () => {
  rejects(override(generatedPath, source => `import { parse } from '../../core.js';\n${source}`), /forbidden parser fallback/);
});

test('output guard rejects missing reachable ABI roots', () => {
  const result = audit({
    ...config,
    generated: [{ file: manifest.generated[0].file, roots: ['DafnyCore.Engine.MissingBinding'] }],
  }, base);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /required generated root .* was not found/);
});

test('output guard rejects an inaccurate generated declaration', () => {
  const expected = manifest.declarationSha256['../src/dafny/generated/engine.d.ts'];
  assert.ok(expected, 'manifest must pin the reviewed declaration ABI');
  const result = audit({ ...config, declarationSha256: manifest.declarationSha256 }, base,
    override(declarationPath, source => source.replace('ParseSingle(): unknown;', 'ParseSingle(): string;')));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /declaration ABI digest changed/);
});

test('output guard rejects a changed internal class method map', () => {
  const shapePath = path.resolve(base, manifest.shapeManifest);
  rejects(override(shapePath, source => source.replace('"m0"', '"changed"')),
    /trusted boundary source digest changed/);
});

test('output guard rejects a generated internal method that disagrees with the pinned map', () => {
  const source = fs.readFileSync(generatedPath, 'utf8');
  const changed = source.replace(/(^[ \t]*)m0\([^)]*\)/m, '$1m999()');
  assert.notEqual(changed, source, 'mutation did not find an internal method');
  rejects({ [generatedPath]: changed }, /method map differs|ambiguous helper|unaudited/);
});
