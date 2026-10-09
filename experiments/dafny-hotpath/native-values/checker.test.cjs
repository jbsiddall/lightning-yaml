'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { audit } = require('./check-output.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-output-guard-'));
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
let sequence = 0;
function check(source, config = {}, extension = '.js') {
  const filename = `case-${sequence++}${extension}`;
  fs.writeFileSync(path.join(directory, filename), source);
  return audit({ wholeFiles: [filename], ...config }, directory);
}
function rejects(source, pattern, config, extension) {
  const result = check(source, config, extension);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), pattern);
  assert.match(result.diagnostics.join('\n'), /case-\d+\.[^:]+:\d+:\d+:/);
}

test('native arrays, objects, maps, sentinels and primitive coercions pass', () => {
  const result = check(`
    function plain(v) {
      const list = []; const sparse = Array(10); const allocated = new Array(2);
      const map = new Map(); const weak = new WeakMap();
      const object = { v, list, nil: null, absent: undefined };
      return [object, sparse, allocated, map, weak, Number('1'), String(v), Object.is(v, null)];
    }
  `);
  assert.deepEqual(result.diagnostics, []);
});

test('comments and literal text cannot trigger any or boxing findings', () => {
  assert.equal(check('// any BigNumber new Number\nconst text = "BigInt any _dafny.Seq";', {}, '.ts').ok, true);
});

test('explicit any is rejected in TS and public declarations', () => {
  rejects('export function parse(input: any): unknown { return input; }', /explicit TypeScript any/, {}, '.ts');
  rejects('export declare function parse(input: string): any;', /explicit TypeScript any/, {}, '.d.ts');
});

test('primitive wrapper constructors fail while native coercion calls pass', () => {
  for (const name of ['Number', 'String', 'Boolean', 'Object']) rejects(`const v = new ${name}(1);`, /boxing via new/);
  assert.equal(check('const value = Boolean(1);').ok, true);
});

test('big integers, Dafny collections, codepoints and equality runtime fail', () => {
  for (const expression of [
    'new BigNumber(1)', 'BigNumber(1)', 'BigInt(1)', '1n',
    'new _dafny.Seq()', '_dafny.Seq.UnicodeFromString("x")',
    'new _dafny.CodePoint(12)', '_dafny.areEqual(a, b)', '_dafny.ZERO',
  ]) rejects(`const value = ${expression};`, /boxing reference|BigInt representation/);
});

test('datatype constructors and unaudited constructors fail', () => {
  rejects('const value = Values.Value.create_Scalar(1);', /generated datatype constructor/);
  rejects('const value = new Value(1);', /unaudited constructor Value/);
});

test('unknown calls and indirect aliases fail closed', () => {
  rejects('mystery(1);', /unaudited call mystery/);
  rejects('function native(x) { return x; } const alias = native; alias(1);', /unaudited call alias/);
  rejects('const key = "native"; object[key](1);', /unaudited call object\[key\]/);
  rejects('(0, native)(1);', /unaudited call/);
});

test('audited external calls are explicit and still cannot permit known boxing', () => {
  assert.equal(check('NativeValues.__default.push(v, item);', { allowedCalls: ['NativeValues.__default.push'] }).ok, true);
  rejects('new BigNumber(1);', /boxing reference/, { allowedConstructors: ['BigNumber'] });
  rejects('new Number(1);', /boxing via new/, { allowedConstructors: ['Number'] });
});

test('shadowed builtin spelling fails closed', () => {
  rejects('function run(Number) { return Number(1); }', /redefinition of protected native\/runtime name Number/);
  rejects('function run() { const Array = () => 1; return Array(); }', /redefinition of protected native\/runtime name Array/);
});

test('parameter alias cannot masquerade as a same-file helper', () => {
  rejects('function safe(v) { return v; } function run(safe) { return safe(1); }', /indirect call through parameter safe/);
});

test('local variable cannot masquerade as a harmless same-file helper', () => {
  const result = checkGenerated(`
    function safe(v) { return v; }
    function hidden(v) { return new Number(v); }
    ${generated('const safe = hidden; return safe(v);')}
  `);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /unsupported local binding safe/);
});

test('block-local helper declarations, variables and destructuring fail closed', () => {
  for (const body of [
    'if (v) { const safe = hidden; return safe(v); } return v;',
    'if (v) { function safe(x) { return hidden(x); } return safe(v); } return v;',
    'const { safe } = aliases; return safe(v);',
  ]) {
    const result = checkGenerated(`function safe(v) { return v; } function hidden(v) { return new Number(v); } ${generated(body)}`);
    assert.equal(result.ok, false);
    assert.match(result.diagnostics.join('\n'), /unsupported local binding safe/);
  }
  rejects('function safe(v) { return v; } { const safe = hidden; safe(1); }', /unsupported local binding safe/);
});

test('rebinding an outer callable cannot hide its replacement implementation', () => {
  const result = checkGenerated(`function safe(v) { return v; } function hidden(v) { return new Number(v); } ${generated('safe = hidden; return safe(v);')}`);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /rebinding of callable safe/);
});

test('top-level callable rebinding cannot escape a generated-root scan', () => {
  const result = checkGenerated(`function safe(v) { return v; } function hidden(v) { return new Number(v); } safe = hidden; ${generated('return safe(v);')}`);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /rebinding of callable safe/);
});

function generated(body, helpers = '') {
  return `
    const BigNumber = require('bignumber.js');
    let _dafny = (() => { const ignored = new BigNumber(0); return { ignored }; })();
    let Demo = (function() {
      let $module = {};
      $module.__default = class __default {
        static Root(v) { ${body} }
        ${helpers}
      };
      return $module;
    })();
  `;
}
function checkGenerated(source, roots = ['Demo.__default.Root']) {
  const filename = `case-${sequence++}.js`;
  fs.writeFileSync(path.join(directory, filename), source);
  return audit({ generated: [{ file: filename, roots }] }, directory);
}

test('generated roots exclude embedded unused Dafny runtime', () => {
  assert.equal(checkGenerated(generated('return [v, null, undefined];')).ok, true);
});

test('generated reachable helpers are traversed after new boxing regression', () => {
  assert.equal(checkGenerated(generated('return Demo.__default.Helper(v);', 'static Helper(v) { return [v]; }')).ok, true);
  const mutation = checkGenerated(generated('return Demo.__default.Helper(v);', 'static Helper(v) { return new BigNumber(v); }'));
  assert.equal(mutation.ok, false);
  assert.match(mutation.diagnostics.join('\n'), /boxing reference BigNumber/);
});

test('renamed or missing roots fail rather than skip the generated code', () => {
  const missing = checkGenerated(generated('return v;'), ['Demo.__default.Renamed']);
  assert.equal(missing.ok, false);
  assert.match(missing.diagnostics.join('\n'), /required generated root .* was not found/);
  const empty = checkGenerated(generated('return v;'), []);
  assert.equal(empty.ok, false);
  assert.match(empty.diagnostics.join('\n'), /at least one explicit named root/);
});

test('renamed helper that still boxes is found through its callsite', () => {
  const result = checkGenerated(generated('return Demo.__default.Renamed(v);', 'static Renamed(v) { return new BigNumber(v); }'));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /boxing reference BigNumber/);
});

test('new unresolved helper is a failure', () => {
  const result = checkGenerated(generated('return Demo.__default.Unknown(v);'));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /unaudited call Demo.__default.Unknown/);
});

test('boxing alias outside the selected generated body cannot hide its call', () => {
  const result = checkGenerated(`const HiddenBox = BigNumber;\n${generated('return new HiddenBox(v);')}`);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /unaudited constructor HiddenBox/);
});

test('recursive helper graph terminates and scans all helper bodies', () => {
  const result = checkGenerated(generated('return Demo.__default.A(v);', `
    static A(v) { return Demo.__default.B(v); }
    static B(v) { if (v) return Demo.__default.A(null); return new BigNumber(0); }
  `));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /boxing reference BigNumber/);
});

test('malformed source, missing files and empty scan fail', () => {
  rejects('function ( {', /parse error/);
  assert.equal(audit({ wholeFiles: ['missing.js'] }, directory).ok, false);
  assert.equal(audit({}, directory).ok, false);
});

test('same-file allowlisted helper still has its implementation checked', () => {
  rejects('function sneaky() { return new BigNumber(0); } sneaky();', /boxing reference BigNumber/, { allowedCalls: ['sneaky'] });
});

function moduleFixture(mutate = {}) {
  const prefix = `modules-${sequence++}`;
  const files = {
    'runtime.ts': 'export function createHeap(): object { return {}; }',
    'api.ts': 'import { createHeap } from "./runtime"; export function run(): object { return createHeap(); }',
    'runtime.js': 'exports.createHeap = createHeap; function createHeap() { return {}; }',
    'api.js': 'const runtime_1 = require("./runtime"); function run() { return (0, runtime_1.createHeap)(); }',
    ...mutate,
  };
  fs.mkdirSync(path.join(directory, prefix));
  for (const [filename, source] of Object.entries(files)) fs.writeFileSync(path.join(directory, prefix, filename), source);
  return audit({ wholeFiles: Object.keys(files).map(filename => `${prefix}/${filename}`) }, directory);
}

test('source and emitted modules resolve their own helper implementation without ambiguity', () => {
  assert.deepEqual(moduleFixture().diagnostics, []);
});

test('boxing regression in emitted imported helper is detected', () => {
  const result = moduleFixture({ 'runtime.js': 'exports.createHeap = createHeap; function createHeap() { return new Number(1); }' });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /runtime\.js:\d+:\d+: primitive\/object boxing/);
});

test('missing, nonlocal and dynamic require never receives a general exemption', () => {
  for (const call of ['require("./missing")', 'require("unknown-package")', 'require(path)', 'require("node:fs")']) {
    const result = moduleFixture({ 'api.js': `const runtime_1 = ${call};` });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics.join('\n'), /unaudited call require/);
  }
});

test('required file must be explicitly included even if it exists', () => {
  const prefix = `unlisted-${sequence++}`;
  fs.mkdirSync(path.join(directory, prefix));
  fs.writeFileSync(path.join(directory, prefix, 'runtime.js'), 'exports.box = () => new Number(1);');
  fs.writeFileSync(path.join(directory, prefix, 'api.js'), 'const runtime = require("./runtime");');
  const result = audit({ wholeFiles: [`${prefix}/api.js`] }, directory);
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /unaudited call require/);
});

test('unknown imported member and nonstandard comma call fail', () => {
  for (const expression of ['(0, runtime_1.missing)()', '(1, runtime_1.createHeap)()']) {
    const result = moduleFixture({ 'api.js': `const runtime_1 = require("./runtime"); ${expression};` });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics.join('\n'), /unaudited call/);
  }
});

test('import alias rebinding fails before it can hide a new implementation', () => {
  const result = moduleFixture({ 'api.js': 'const runtime_1 = require("./runtime"); runtime_1.createHeap = sneaky; (0, runtime_1.createHeap)();' });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join('\n'), /mutation of imported binding runtime_1/);
});

test('local declarations cannot shadow named or namespace imports', () => {
  const named = moduleFixture({ 'api.ts': 'import { createHeap } from "./runtime"; function run() { const createHeap = hidden; return createHeap(); }' });
  assert.equal(named.ok, false);
  assert.match(named.diagnostics.join('\n'), /unsupported local binding createHeap/);
  const namespace = moduleFixture({ 'api.js': 'const runtime_1 = require("./runtime"); function run() { const runtime_1 = hidden; return (0, runtime_1.createHeap)(); }' });
  assert.equal(namespace.ok, false);
  assert.match(namespace.diagnostics.join('\n'), /unsupported local binding runtime_1/);
});
