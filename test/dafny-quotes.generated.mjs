import assert from 'node:assert/strict';
import { loadGeneratedEngine } from './helpers/load-generated-engine.mjs';

const overrides = {};
if (process.env.LY_INJECT_BAD_ESCAPER) overrides.stringFromCharCode = () => '?';
if (process.env.LY_INJECT_BAD_FOLD) overrides.repeat = () => '';
const generated = loadGeneratedEngine(overrides);
const parse = generated.DafnyCore.__default.Parse;
const Engine = generated.DafnyCore.Engine;
const lf = String.fromCharCode(10);
const cr = String.fromCharCode(13);
const crlf = cr + lf;
const values = [
  ['"plain 🎉 text"', 'plain 🎉 text'],
  ['"\\" \\\\ \\/ \\0 \\a \\b \\e \\f \\n \\r \\t \\v \\  \\N \\_ \\L \\P"', '" \\ / \0 \x07 \x08 \x1b \x0c \n \r \t \x0b   \u0085 \u00a0 \u2028 \u2029'],
  ['"\\x41\\u00E9\\U0001F600"', 'Aé😀'],
  ['"\\uD800\\uDC00"', '𐀀'],
  ['"\\uD800"', '\ud800'],
  ['"\\U0001F600"', '😀'],
  ['" trailing "', ' trailing '],
  ["' leading '", ' leading '],
  ["'it''s fine'", "it's fine"],
  ['["plain", "escaped \\n", "tail"]', ['plain', 'escaped \n', 'tail']],
  ['"a' + lf + 'b"', 'a b'],
  ['"a' + lf + lf + 'b"', 'a\nb'],
  ['"a' + lf + lf + lf + 'b"', 'a\n\nb'],
  ['"a   ' + lf + '   b"', 'a b'],
  ["'a" + lf + "b'", 'a b'],
  ["'x" + lf + lf + "y'", 'x\ny'],
  ['"a' + lf + '  \tb"', 'a b'],
  ['"a\\' + lf + '   b"', 'ab'],
  ['"a\\' + crlf + '\tb"', 'ab'],
  ['"a' + crlf + 'b"', 'a b'],
  ['"a' + cr + 'b"', 'a\rb'],
  ['["key", \'value\']', ['key', 'value']],
  ['{"quoted key": "quoted value"}', { 'quoted key': 'quoted value' }],
  ['"a' + lf + '  --- x' + lf + 'b"', 'a --- x b'],
];
for (const [input, expected] of values) {
  assert.deepStrictEqual(parse(input), expected, `wrong quote result for ${JSON.stringify(input)}`);
}

const errors = [
  ['"\\u12Q4"', 'invalid hex digit in \\u escape (line 1, column 1)'],
  ['"\\q"', 'invalid escape sequence in double-quoted string (line 1, column 1)'],
  ['"unterminated', 'unterminated double-quoted string (line 1, column 1)'],
  ["'unterminated", 'unterminated single-quoted string (line 1, column 1)'],
  ['"a' + lf + '---' + lf + 'b"', 'unterminated quoted string: a document marker interrupts it (line 1, column 1)'],
];
for (const [input, message] of errors) {
  assert.throws(() => parse(input), (error) => error.name === 'YAMLParseError' && error.message === message);
}

const nested = new Engine();
nested.Reset('"a' + lf + 'b"', false, false, 4194304);
generated.setEngineField(nested, 'flowIndentFloor', 0);
assert.throws(
  () => generated.engineMethod(nested, 'ParseDoubleQuoted')(),
  (error) => error.name === 'YAMLParseError' && error.message === 'insufficient indentation for a multi-line quoted scalar (line 2, column 1)',
);

console.log(`generated quote checks passed: ${values.length} values, ${errors.length} errors, indentation boundary`);
