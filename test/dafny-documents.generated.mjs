import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Native as host } from '../src/dafny/native.ts';

const generatedPath = fileURLToPath(new URL('../src/dafny/Native.js', import.meta.url));
const generatedRequire = createRequire(generatedPath);
const generatedModule = { exports: {} };
const source = readFileSync(generatedPath, 'utf8');
new Function('require', 'module', 'exports', 'host',
  `${source}\nNative.__default = Object.assign({}, host.__default); module.exports = { Parse: DafnyCore.__default.Parse, ParseAll: DafnyCore.__default.ParseAll };`)(
  generatedRequire, generatedModule, generatedModule.exports, host,
);
const { Parse, ParseAll } = generatedModule.exports;

assert.deepStrictEqual(Parse('[0, -0, +42, 007, 00, 0o17, 0o777, 0x1A, 0xFF, 0xdeadBEEF]'), [0, -0, 42, 7, 0, 15, 511, 26, 255, 0xdeadbeef]);
assert.ok(Object.is(Parse('-0'), -0));
assert.deepStrictEqual(Parse('[9007199254740993, 123456789012345, 1.5, 1e21, .inf, -.inf, .nan]'), [9007199254740993, 123456789012345, 1.5, 1e21, Infinity, -Infinity, NaN]);
assert.ok(Object.is(Parse('!!int -0'), -0));
assert.deepStrictEqual(Parse('[!!float 1.5, !!float 1e2, !!int 123456789012345]'), [1.5, 100, 123456789012345]);

assert.deepStrictEqual(Parse('%YAML 1.2\n---\na: 1\n'), { a: 1 });
assert.deepStrictEqual(Parse('%YAML 1.3\n---\ntrue'), true);
assert.deepStrictEqual(Parse('%TAG !e! tag:example.com,2026:\n---\n!e!thing value'), 'value');
assert.deepStrictEqual(ParseAll('%TAG !e! tag:example.com,2026:\n---\n!e!thing one\n...\n---\ntwo'), ['one', 'two']);
assert.deepStrictEqual(Parse('!!binary SGVsbG8='), new Uint8Array([72, 101, 108, 108, 111]));
assert.deepStrictEqual(Parse('!!set\na: null\nb: ~\n'), new Set(['a', 'b']));
assert.deepStrictEqual(Parse('!!omap\n- a: 1\n- b: 2\n'), new Map([['a', 1], ['b', 2]]));
assert.deepStrictEqual(Parse('!!pairs\n- a: 1\n- b: 2\n'), [{ a: 1 }, { b: 2 }]);
assert.deepStrictEqual(Parse('|\n  alpha\n  beta\n'), 'alpha\nbeta\n');
assert.deepStrictEqual(Parse('>\n  alpha\n  beta\n'), 'alpha beta\n');
assert.deepStrictEqual(Parse('a: |-\n  alpha\nb: 2\n'), { a: 'alpha', b: 2 });
assert.deepStrictEqual(Parse('!!str |\n  123\n'), '123\n');
assert.deepStrictEqual(Parse('[alpha\n  beta, x\n\n  y]'), ['alpha beta', 'x\ny']);
assert.deepStrictEqual(Parse('{alpha\n  beta: 1}'), { 'alpha beta': 1 });
assert.deepStrictEqual(Parse('[1 x\n 2, true\n false]'), ['1 x 2', 'true false']);
assert.deepStrictEqual(Parse('? key\n: value\n'), { key: 'value' });
assert.deepStrictEqual(Parse(': value\nkey: v2\n'), { '': 'value', key: 'v2' });
assert.deepStrictEqual(Parse('a: 1\n? b\n: 2\nc: 3\n'), { a: 1, b: 2, c: 3 });
assert.deepStrictEqual(Parse('? a\n: 1\nb: 2\n'), { a: 1, b: 2 });
assert.deepStrictEqual(Parse('mapping:\n  ? sea\n  : green\n  sky: blue\n'), { mapping: { sea: 'green', sky: 'blue' } });
assert.deepStrictEqual(Parse('a: 1\n...\n'), { a: 1 });
assert.deepStrictEqual(Parse('--- !!set\na: null\n'), new Set(['a']));
assert.deepStrictEqual(Parse('--- !!map\n? a\n: 1\n'), { a: 1 });
assert.throws(() => Parse('key1: &a value\nkey2: &b *a\n'), /alias node cannot carry an anchor property/);
assert.throws(() => Parse('top1: &node1\n  &k1 key1: val1\ntop2: &node2\n  &v2 val2\n'), /node can have at most one anchor/);
assert.throws(() => Parse('foo:\n\tbar\n', true), /tab character cannot be used as indentation/);
assert.throws(() => Parse('key: - item\n'), /block sequence cannot start/);
assert.throws(() => Parse('?\t-\n'), /tab cannot separate '\?' from a key/);
assert.throws(() => Parse('? a\n:\t- b\n'), /tab cannot separate ':' from a value/);
assert.deepStrictEqual(Parse('? [a, b]\n: value\n'), { '[ a, b ]': 'value' });
assert.deepStrictEqual(Parse('? key\n: value\n? other\n: 2\n'), { key: 'value', other: 2 });
assert.deepStrictEqual(Parse('? key\n: value\nother: next\n'), { key: 'value', other: 'next' });
assert.deepStrictEqual(Parse('? a: 1\n  b: 2\n: v\n'), { '{ a: 1, b: 2 }': 'v' });
assert.deepStrictEqual(Parse('? &a a\n: &b b\n: *a\n'), { a: 'b', '': 'a' });
assert.deepStrictEqual(Parse('a: 1\n? b\n&anchor c: 3\n'), { a: 1, b: null, c: 3 });
assert.deepStrictEqual(ParseAll('--- !!map\n? a\n: b\n--- !!seq\n- !!str c\n--- !!str\nd\ne\n'), [{ a: 'b' }, ['c'], 'd e']);
assert.deepStrictEqual(Parse('hello\n  world\n'), 'hello world');
assert.deepStrictEqual(Parse('a: hello\n  world\nb: next\n'), { a: 'hello world', b: 'next' });
assert.deepStrictEqual(Parse('hello\n\n  world\n'), 'hello\nworld');
assert.deepStrictEqual(Parse('!!str hello\n  world\n'), 'hello world');
assert.deepStrictEqual(Parse('a: hello # comment\nb: value\n'), { a: 'hello', b: 'value' });
assert.deepStrictEqual(Parse('"quoted": value\n'), { quoted: 'value' });
assert.deepStrictEqual(Parse('[flow, key]: value\n'), { '[ flow, key ]': 'value' });
assert.deepStrictEqual(Parse('a:\n- b\n'), { a: ['b'] });
assert.deepStrictEqual(Parse('a: &x\nb: *x\n'), { a: null, b: null });
assert.deepStrictEqual(Parse('!!str a: 1\n'), { a: 1 });
assert.deepStrictEqual(Parse('!!str "quoted": value\n'), { quoted: 'value' });
assert.deepStrictEqual(Parse('!!seq [flow, key]: value\n'), { '[ flow, key ]': 'value' });
assert.deepStrictEqual(Parse('a: !!str &x hi\nb: *x\n'), { a: 'hi', b: 'hi' });
assert.deepStrictEqual(Parse('a: !!map &m {x: 1}\nb: *m\n'), { a: { x: 1 }, b: { x: 1 } });
assert.throws(() => Parse('a:\n \t- b\n', true), (error) => error.name === 'YAMLParseError' && error.message === 'a tab character cannot be used as indentation (line 2, column 2)');

const errors = [
  ['%YAML 2.0\n---\nx', 'unsupported YAML major version: 2 (line 1, column 10)'],
  ['%YAML 1\n---\nx', 'malformed %YAML directive: expected a MAJOR.MINOR version (line 1, column 8)'],
  ['%YAML 1.2\nx', "a directives block must be terminated by an explicit '---' document start (line 2, column 1)"],
  ['%TAG !e! a\n%TAG !e! b\n---\nx', "duplicate %TAG directive for handle '!e!' (line 2, column 11)"],
  ['!!binary not!base64', 'malformed !!binary content: base64 length must be a multiple of 4 after stripping whitespace: unexpected end of input'],
  ['!!set\na: 1\n', '!!set: every key must have a null value: unexpected end of input'],
];
for (const [yaml, message] of errors) {
  assert.throws(() => Parse(yaml), (error) => error.name === 'YAMLParseError' && error.message === message);
}
console.log('generated document directive checks passed');
