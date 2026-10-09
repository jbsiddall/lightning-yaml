import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { parse, parseAll, stringify, YAMLParseError } from '../dist/index.js';
import { parse as yamlParse, parseDocument } from '../dist/yaml-compat.js';
import { load, loadAll, YAMLException } from '../dist/js-yaml-compat.js';

test('ESM public and compatibility entries execute from built output', () => {
  assert.deepEqual(parse('a: 1'), { a: 1 });
  assert.deepEqual(parseAll('---\na: 1\n---\nb: 2'), [{ a: 1 }, { b: 2 }]);
  assert.equal(stringify({ a: 1 }), 'a: 1\n');
  assert.deepEqual(yamlParse('a: 1'), { a: 1 });
  assert.deepEqual(parseDocument('a: 1').toJS(), { a: 1 });
  assert.deepEqual(load('a: 1'), { a: 1 });
  assert.deepEqual(loadAll('---\na: 1'), [{ a: 1 }]);
});

test('built errors retain their public class identity', () => {
  assert.throws(() => parse('[unterminated'), error => error instanceof YAMLParseError);
  assert.throws(() => load('[unterminated'), error => error instanceof YAMLException);
});

test('CommonJS and CDN IIFE entries work without Node globals', async () => {
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/index.cjs');
  assert.deepEqual(cjs.parse('a: 1'), { a: 1 });
  assert.equal(cjs.stringify({ a: 1 }), 'a: 1\n');

  const browser = {};
  const cdnBundle = readFileSync(new URL('../dist/lightning-yaml.min.js', import.meta.url), 'utf8');
  const dafnyLicense = readFileSync(new URL('../Dafny-LICENSE.txt', import.meta.url), 'utf8').trimEnd();
  assert.ok(cdnBundle.includes(`/*! ${dafnyLicense}\n*/`), 'minified CDN bundle must retain the complete Dafny license');
  vm.runInNewContext(cdnBundle, browser);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.YAML.parse('a: 1'))), { a: 1 });
  assert.equal(browser.YAML.stringify({ a: 1 }), 'a: 1\n');
});
