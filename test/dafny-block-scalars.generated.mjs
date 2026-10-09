import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parse as baseline } from '../src/core.ts';
import { Native as host } from '../src/dafny/native.ts';

const generatedPath = fileURLToPath(new URL('../src/dafny/Native.js', import.meta.url));
const generatedRequire = createRequire(generatedPath);
const generatedModule = { exports: {} };
const source = readFileSync(generatedPath, 'utf8');
const wiredHost = { ...host };
if (process.env.LY_INJECT_BAD_CHOMP) wiredHost.repeat = () => '';
new Function(
  'require', 'module', 'exports', 'host',
  `${source}\nNative.__default = Object.assign({}, host.__default); module.exports = { Engine: DafnyCore.Engine };`
)(generatedRequire, generatedModule, generatedModule.exports, wiredHost);

const Engine = generatedModule.exports.Engine;
function direct(input, parentCol, marker = 0) {
  const engine = new Engine();
  engine.Reset(input, false, false, 4194304);
  engine.pos = marker;
  const value = engine.ParseBlockScalar(parentCol);
  return { value, pos: engine.pos, lineStart: engine.lineStart };
}
function baselineValue(input, kind, key = 'key') {
  const value = baseline(input);
  if (kind === 'map') return value[key];
  if (kind === 'sequence') return value[0];
  return value;
}

const cases = [
  ['|\n  line1\n  line2\n', -1, 'root', 'line1\nline2\n'],
  ['|-\n  line1\n  line2\n', -1, 'root', 'line1\nline2'],
  ['|+\n  line1\n  line2\n\n\n', -1, 'root', 'line1\nline2\n\n\n'],
  ['|\n\n\n', -1, 'root', ''],
  ['|+\n\n\n', -1, 'root', '\n\n'],
  ['|2\n    xxx\n', 0, 'map', '  xxx\n'],
  ['|-2\n  chomp and indent\n', 0, 'map', 'chomp and indent'],
  ['|+2\n  keep and indent\n', -1, 'root', ' keep and indent\n'],
  ['|2-\n  explicit indent\n', 0, 'sequence', 'explicit indent'],
  ['>\n  some\n  text\n', -1, 'root', 'some text\n'],
  ['>\n  a\n\n  b\n', -1, 'root', 'a\nb\n'],
  ['>\n  a\n\n\n  b\n', -1, 'root', 'a\n\nb\n'],
  ['>\n  a\n   more\n  b\n', -1, 'root', 'a\n more\nb\n'],
  ['>\n  a\n   b\n   c\n', -1, 'root', 'a\n b\n c\n'],
  ['>\n  a\n   b\n\n   c\n', -1, 'root', 'a\n b\n\n c\n'],
  ['>\n\n folded\n line\n\n next\n', -1, 'root', '\nfolded line\nnext\n'],
  ['|\n  # literal content\n', -1, 'root', '# literal content\n'],
  ['| # header comment\n  line\n', -1, 'root', 'line\n'],
  ['|\n  \tfoo\n', -1, 'root', '\tfoo\n'],
  ['|\n  line\n# comment\nnext: 1\n', -1, 'map', 'line\n'],
  ['|\r\n  a\r\n  b\r\n', -1, 'root', 'a\nb\n'],
  ['|\n  line', -1, 'root', 'line\n'],
  ['|-\n  line', -1, 'root', 'line'],
  ['>\n  line', -1, 'root', 'line\n'],
  ['|\n  detected\n', 0, 'sequence', 'detected\n'],
  ['>\n \n  \n  # detected\n', 0, 'sequence', '\n\n# detected\n'],
  ['|2\n       \n  content\n', 0, 'map', '     \ncontent\n'],
  ['|\n  text\n', 0, 'inlineRoot', 'text\n'],
];

for (const [scalar, parentCol, kind, expected] of cases) {
  let input = scalar;
  let marker = 0;
  if (kind === 'map') { input = `key: ${scalar}`; marker = input.search(/[|>]/); }
  if (kind === 'sequence') { input = `- ${scalar}`; marker = input.search(/[|>]/); }
  if (kind === 'inlineRoot') { input = `--- ${scalar}`; marker = input.search(/[|>]/); }
  const actual = direct(input, kind === 'inlineRoot' ? -2 : parentCol, marker);
  const reference = baselineValue(input, kind === 'inlineRoot' ? 'root' : kind);
  assert.deepStrictEqual(actual.value, expected, `expected value for ${JSON.stringify(input)}`);
  assert.deepStrictEqual(actual.value, reference, `baseline mismatch for ${JSON.stringify(input)}`);
  assert.ok(actual.pos <= input.length && actual.lineStart <= actual.pos, `invalid final cursor for ${JSON.stringify(input)}`);
}

const errors = [
  ['key: > first line\n  second line\n', 0, 'invalid block scalar header (expected an indentation indicator, chomping indicator, comment, or end of line) (line 1, column 8)'],
  ['key: ># comment\n  scalar\n', 0, 'a comment after a block scalar header must be preceded by whitespace (line 1, column 7)'],
  ['key: |\n\tfoo\n', 0, 'tab characters are not allowed in block scalar indentation (line 2, column 1)'],
  ['block scalar: >\n \n  \n   \n invalid\n', 0, "a block scalar's leading empty lines must not be more indented than its first line of content (line 2, column 1)"],
];
for (const [input, parentCol, message] of errors) {
  const marker = input.search(/[|>]/);
  const engine = new Engine();
  engine.Reset(input, false, false, 4194304);
  engine.pos = input.search(/[|>]/);
  assert.throws(
    () => engine.ParseBlockScalar(parentCol),
    (error) => error.name === 'YAMLParseError' && error.message === message,
    `wrong block scalar error for ${JSON.stringify(input)}`,
  );
  assert.throws(
    () => baseline(input),
    (error) => error.name === 'YAMLParseError' && error.message === message,
    `baseline error changed for ${JSON.stringify(input)}`,
  );
  assert.ok(marker >= 0);
}

const dedentInput = 'key: |\n  line\nnext: 1\n';
const nextKey = dedentInput.indexOf('next');
const dedentCursor = direct(dedentInput, 0, dedentInput.indexOf('|'));
assert.deepStrictEqual({ pos: dedentCursor.pos, lineStart: dedentCursor.lineStart }, { pos: nextKey, lineStart: nextKey });

const markerInput = '--- |\n  text\n...\n';
const markerIndex = markerInput.indexOf('...');
const markerCursor = direct(markerInput, -2, markerInput.indexOf('|'));
assert.deepStrictEqual({ pos: markerCursor.pos, lineStart: markerCursor.lineStart }, { pos: markerIndex, lineStart: markerIndex });

const nestedInput = 'outer:\n  inner: |\n    text\n  sibling: 1\n';
const nestedMarker = nestedInput.indexOf('|');
const nestedResult = direct(nestedInput, 2, nestedMarker);
assert.strictEqual(nestedResult.value, baseline(nestedInput).outer.inner);
assert.strictEqual(nestedResult.value, 'text\n');
assert.strictEqual(nestedResult.pos, nestedInput.indexOf('sibling'));
assert.strictEqual(nestedResult.lineStart, nestedInput.indexOf('  sibling'));

const crCommentInput = '|\n  text\n# comment\rnext';
const crCommentCursor = direct(crCommentInput, -1);
assert.deepStrictEqual({ pos: crCommentCursor.pos, lineStart: crCommentCursor.lineStart }, { pos: crCommentInput.length, lineStart: crCommentInput.length });

const lookahead = new Engine();
const lookaheadInput = '|\n \n  content';
lookahead.Reset(lookaheadInput, false, false, 4194304);
lookahead.pos = 2;
assert.strictEqual(lookahead.DetectBlockScalarIndent(-1), 2);
assert.deepStrictEqual({ pos: lookahead.pos, lineStart: lookahead.lineStart }, { pos: 2, lineStart: 0 });

console.log(`generated block scalar checks passed: ${cases.length} values, ${errors.length} errors, cursor/indent boundaries`);
