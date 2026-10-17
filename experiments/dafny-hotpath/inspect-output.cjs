// Restrict inspection to hot methods: the generated runtime contains BigNumber
// helpers even when these methods themselves use only native numbers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tooling = process.argv[2];
if (!tooling) throw Error('Usage: node inspect-output.cjs /path/to/node_modules [generated.js]');
const ts = require(path.join(tooling, 'typescript'));
const filename = process.argv[3] || path.join(__dirname, 'DirectCast.js');
const parsed = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const expected = new Set(['FlowPlainLine', 'QuoteEnd']);
const found = [];
const problems = [];
function inspect(node, method) {
  if (ts.isIdentifier(node) && ['BigNumber', 'BigInt', 'CodePoint', 'UnicodeFromString',
      'toNumber', 'toBigNumber', 'plus', 'minus', 'multipliedBy', '_dafny'].includes(node.text)) {
    problems.push({method, token: node.text});
  }
  if (ts.isBigIntLiteral(node)) problems.push({method, token: node.text});
  ts.forEachChild(node, child => inspect(child, method));
}
function visit(node) {
  if (ts.isMethodDeclaration(node) && expected.has(node.name.getText(parsed))) {
    const name = node.name.getText(parsed);
    found.push(name);
    assert(node.body, `${name} lost its body`);
    inspect(node.body, name);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.deepEqual(found.sort(), [...expected].sort(), 'Generated methods changed; review output');
assert.deepEqual(problems, [], 'Unexpected numeric conversion or runtime helper in hot methods');
console.log(JSON.stringify({inspection: 'passed', file: path.basename(filename), methods: found,
  scope: 'direct method bodies; manually inspect any callees and shipped bundle too'}));
