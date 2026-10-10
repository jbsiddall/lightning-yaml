import assert from 'node:assert/strict';
import test from 'node:test';
import { DafnyCore, Serializer } from '../src/dafny/generated/engine.js';
import { parseAllWithDafny, parseWithDafny, stringifyWithDafny } from '../src/dafny/bridge.ts';
import { YAMLParseError } from '../src/errors.ts';

test('checked generated ESM executes parser and serializer roots', () => {
  assert.deepEqual(DafnyCore.__default.Parse('a: 1', false), { a: 1 });
  assert.deepEqual(DafnyCore.__default.ParseAll('---\na: 1\n---\nb: 2', false), [{ a: 1 }, { b: 2 }]);
  const writer = new Serializer.Writer();
  writer.__ctor();
  assert.equal(writer.Stringify({ a: 1 }), 'a: 1\n');
});

test('checked bridge forwards options, cleans up failures, and calls the serializer wrapper', () => {
  const optionReads = [];
  const observedOptions = {
    get strict() { optionReads.push('strict'); return true; },
    optimizations: {
      get internStrings() { optionReads.push('internStrings'); return true; },
      get keyCacheMaxKb() { optionReads.push('keyCacheMaxKb'); return 0.5; },
    },
  };
  assert.deepEqual(parseWithDafny('a: 1', {
    strict: true,
    optimizations: { internStrings: true, keyCacheMaxKb: 0.5 },
  }), { a: 1 });
  assert.deepEqual(parseWithDafny('a: 1', observedOptions), { a: 1 });
  assert.deepEqual(optionReads, ['internStrings', 'strict', 'keyCacheMaxKb']);
  assert.deepEqual(parseAllWithDafny('---\na: 1\n---\nb: 2'), [{ a: 1 }, { b: 2 }]);
  assert.throws(() => parseWithDafny('[unterminated'), error => error instanceof YAMLParseError);
  assert.deepEqual(parseWithDafny('ok: true'), { ok: true });
  assert.equal(stringifyWithDafny({ a: 1 }), 'a: 1\n');
});

test('serializer array loops observe getter-driven length changes', () => {
  const values = ['first'];
  let reads = 0;
  Object.defineProperty(values, '0', {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      if (reads === 2) values.push('added-during-write');
      return 'first';
    },
  });
  assert.equal(stringifyWithDafny({ values }), 'values:\n  - first\n  - added-during-write\n');
});

test('generated parser errors preserve the host error class', () => {
  assert.throws(() => DafnyCore.__default.Parse('[unterminated', false), error => error instanceof YAMLParseError);
});
