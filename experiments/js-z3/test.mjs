import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.join(here, 'examples');
const defaultContracts = JSON.parse(await readFile(path.join(here, 'contracts.json'), 'utf8'));

async function fixture(t, { contracts = defaultContracts, files = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'js-z3-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const exampleRoot = path.join(dir, 'examples');
  await cp(examples, exampleRoot, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(exampleRoot, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const config = { ...contracts, exampleRoot };
  const configPath = path.join(dir, 'contracts.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { dir, exampleRoot, configPath, config };
}

function runVerifier({ configPath, dir, z3 = process.env.JS_Z3_SOLVER ?? 'z3', timeoutMs = 5000 }) {
  return spawnSync(process.execPath, [
    path.join(here, 'verify.mjs'), configPath,
    '--z3', z3,
    '--out', path.join(dir, 'solver-output'),
    '--timeout-ms', String(timeoutMs),
  ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
}

function reportOf(result) {
  assert.equal(result.error, undefined, `verifier process error: ${result.error}`);
  assert.ok(result.stdout, `verifier produced no JSON report; stderr: ${result.stderr}`);
  try { return JSON.parse(result.stdout); }
  catch (error) { assert.fail(`verifier did not print JSON: ${error}\n${result.stdout}\n${result.stderr}`); }
}

function expectRefutation(result, obligation) {
  assert.equal(result.status, 1, `expected a source-level refutation (exit 1), got ${result.status}; stderr: ${result.stderr}`);
  const report = reportOf(result);
  assert.equal(report.status, 'failed');
  assert.ok(report.obligations.some(item => item.obligation === obligation && item.status === 'refuted'),
    `expected ${obligation} to be refuted; got ${JSON.stringify(report.obligations)}`);
}

test('the checked-in examples run through the real solver and report transitive hashes', async t => {
  const sample = await fixture(t);
  const result = runVerifier(sample);
  assert.equal(result.status, 0, `expected proof success; stderr: ${result.stderr}\n${result.stdout}`);
  const report = reportOf(result);
  assert.equal(report.status, 'proved');
  assert.deepEqual(report.claims.map(claim => claim.status), ['proved', 'proved', 'proved']);
  const dependencies = report.claims.find(claim => claim.name === 'yaml-hex-escape').dependencies;
  assert.ok(dependencies.some(dep => dep.file.endsWith('/digits.mjs') && /^[0-9a-f]{64}$/.test(dep.sha256)),
    'the report must include the transitive digit module and its content hash');
});

test('a changed imported digit conversion refutes the concrete claim', async t => {
  const sample = await fixture(t);
  const file = path.join(sample.exampleRoot, 'digits.mjs');
  const source = await readFile(file, 'utf8');
  const changed = source.replace('return code - 48;', 'return code - 47;');
  assert.notEqual(changed, source, 'mutation target must still be present');
  await writeFile(file, changed);
  expectRefutation(runVerifier(sample), 'claim:yaml-hex-escape');
});

test('a weakened arithmetic guard refutes equivalence at its boundary', async t => {
  const sample = await fixture(t);
  const file = path.join(sample.exampleRoot, 'offsets.mjs');
  const source = await readFile(file, 'utf8');
  const changed = source.replace('value > 9007199254740989', 'value > 9007199254740988');
  assert.notEqual(changed, source, 'mutation target must still be present');
  await writeFile(file, changed);
  expectRefutation(runVerifier(sample), 'equivalence:add-two-equivalence');
});

test('removing the overflow boundary exposes the real source arithmetic safety failure', async t => {
  const sample = await fixture(t);
  const file = path.join(sample.exampleRoot, 'offsets.mjs');
  const source = await readFile(file, 'utf8');
  const changed = source.replace('value > 9007199254740989', 'value > 9007199254740990');
  assert.notEqual(changed, source, 'mutation target must still be present');
  await writeFile(file, changed);
  expectRefutation(runVerifier(sample), 'arithmetic-safe:value + 2');
});

test('changing the real loop increment refutes the annotated proof', async t => {
  const sample = await fixture(t);
  const file = path.join(sample.exampleRoot, 'cursor.mjs');
  const source = await readFile(file, 'utf8');
  const changed = source.replace('cursor = cursor + 1;', 'cursor = cursor + 2;');
  assert.notEqual(changed, source, 'mutation target must still be present');
  await writeFile(file, changed);
  const result = runVerifier(sample);
  assert.equal(result.status, 1, `loop mutation should be refuted, not accepted as a CLI error: ${result.stderr}`);
  const report = reportOf(result);
  assert.ok(report.obligations.some(item => item.status === 'refuted' && /loop|claim:cursor-termination/.test(item.obligation)),
    `expected a loop or exit-postcondition refutation; got ${JSON.stringify(report.obligations)}`);
});

test('a loop body that passes one initial step but stops making progress fails induction', async t => {
  const sample = await fixture(t);
  const file = path.join(sample.exampleRoot, 'cursor.mjs');
  const source = await readFile(file, 'utf8');
  const changed = source.replace('cursor = cursor + 1;', 'if (cursor > start) { cursor = start; } else { cursor = cursor + 1; }');
  assert.notEqual(changed, source, 'mutation target must still be present');
  await writeFile(file, changed);
  const result = runVerifier(sample);
  assert.equal(result.status, 1, `non-progressing loop should be refuted, not accepted as a CLI error: ${result.stderr}`);
  const report = reportOf(result);
  assert.ok(report.obligations.some(item => item.obligation === 'loop-decreases:advanceToEnd' && item.status === 'refuted'),
    'the arbitrary loop-header preservation step must expose the rank increase');
});

test('a false loop invariant is rejected by an initialization obligation', async t => {
  const sample = await fixture(t);
  sample.config.loops['advanceToEnd:0'].invariant = { op: 'eq', args: [{ var: 'cursor' }, { const: 0 }] };
  await writeFile(sample.configPath, JSON.stringify(sample.config, null, 2));
  const result = runVerifier(sample);
  assert.equal(result.status, 1, `false invariant should fail as a VC, not as a CLI error: ${result.stderr}`);
  const report = reportOf(result);
  assert.ok(report.obligations.some(item => item.status === 'refuted' && /init|invariant/.test(item.obligation)),
    `expected invariant initialization/preservation refutation; got ${JSON.stringify(report.obligations)}`);
});

test('local calls use local bindings even when an export alias has the same spelling', async t => {
  const contracts = {
    exampleRoot: './examples',
    claims: [{ name: 'alias-resolution', file: 'alias.mjs', export: 'entry', params: [], args: [], expected: 1 }],
  };
  const sample = await fixture(t, {
    contracts,
    files: { 'alias.mjs': 'function good() { return 1; }\nfunction alias() { return 2; }\nexport { good as alias };\nexport function entry() { return alias(); }\n' },
  });
  const actual = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(path.join(sample.exampleRoot, 'alias.mjs')).href)}).then(m => process.stdout.write(String(m.entry())))`], { encoding: 'utf8' });
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.stdout, '2', 'the fixture must demonstrate JavaScript ESM behavior');
  expectRefutation(runVerifier(sample), 'claim:alias-resolution');
});

test('unsupported import cycles fail closed with a CLI error', async t => {
  const contracts = {
    exampleRoot: './examples',
    claims: [{ name: 'cycle', file: 'a.mjs', export: 'entry', params: [], args: [], expected: 1 }],
  };
  const sample = await fixture(t, {
    contracts,
    files: {
      'a.mjs': "import { b } from './b.mjs';\nexport function entry() { return b(); }\n",
      'b.mjs': "import { entry } from './a.mjs';\nexport function b() { return entry(); }\n",
    },
  });
  const result = runVerifier(sample);
  assert.equal(result.status, 2, `cycle must be reported as unsupported/error; got ${result.status}: ${result.stdout}`);
});

for (const scenario of [
  {
    name: 'default imports',
    files: {
      'entry.mjs': "import fallback, { value } from './library.mjs';\nexport function entry() { return value(); }\n",
      'library.mjs': 'export function value() { return 1; }\n',
    },
  },
  {
    name: 'duplicate module bindings',
    files: {
      'entry.mjs': "import { value } from './library.mjs';\nfunction value() { return 2; }\nexport function entry() { return value(); }\n",
      'library.mjs': 'export function value() { return 1; }\n',
    },
  },
  {
    name: 'temporal-dead-zone reads',
    files: { 'entry.mjs': 'export function entry() { return value; let value = 1; }\n' },
  },
  {
    name: 'calls shadowed by a local binding',
    files: {
      'entry.mjs': 'function value() { return 1; }\nexport function entry() { { let value = 2; return value(); } }\n',
    },
  },
]) {
  test(`unsupported ${scenario.name} fail closed`, async t => {
    const contracts = {
      exampleRoot: './examples',
      claims: [{ name: 'unsupported', file: 'entry.mjs', export: 'entry', params: [], args: [], expected: 1 }],
    };
    const sample = await fixture(t, { contracts, files: scenario.files });
    const result = runVerifier(sample);
    assert.equal(result.status, 2, `${scenario.name} must be rejected as unsupported/error; got ${result.status}: ${result.stdout}`);
  });
}

test('an inconsistent precondition is reported as vacuous instead of a proof', async t => {
  const contracts = {
    exampleRoot: './examples',
    claims: [{
      name: 'inconsistent-precondition', file: 'entry.mjs', export: 'entry',
      params: [{ name: 'value', type: 'number' }],
      requires: { op: 'and', args: [
        { op: 'ge', args: [{ var: 'value' }, { const: 0 }] },
        { op: 'lt', args: [{ var: 'value' }, { const: 0 }] },
      ] },
      ensures: { op: 'eq', args: [{ var: 'result' }, { const: 1 }] },
    }],
  };
  const sample = await fixture(t, {
    contracts,
    files: { 'entry.mjs': 'export function entry(value) { return 1; }\n' },
  });
  const result = runVerifier(sample);
  assert.equal(result.status, 1, `vacuous precondition must not pass; got ${result.status}: ${result.stdout}`);
  const report = reportOf(result);
  assert.ok(report.obligations.some(item => item.status === 'vacuous'),
    `expected explicit vacuity classification; got ${JSON.stringify(report.obligations)}`);
});

test('solver output containing unsat followed by an error never proves a VC', async t => {
  const contracts = { exampleRoot: './examples', claims: [{ name: 'simple', file: 'entry.mjs', export: 'entry', params: [], args: [], expected: 1 }] };
  const sample = await fixture(t, { contracts, files: { 'entry.mjs': 'export function entry() { return 1; }\n' } });
  const fakeSolver = path.join(sample.dir, 'fake-z3');
  await writeFile(fakeSolver, '#!/bin/sh\nprintf \'unsat\\n(error "trailing failure")\\n\'\n');
  await chmod(fakeSolver, 0o755);
  const result = runVerifier({ ...sample, z3: fakeSolver });
  assert.equal(result.status, 2, `malformed/error solver output must stay inconclusive; got ${result.status}`);
  const report = reportOf(result);
  assert.ok(report.obligations.some(item => item.status === 'error' || item.status === 'malformed'),
    'solver protocol errors must be visible in the report');
});

test('UNKNOWN, timeout, malformed protocol output, and nonzero solver exit are inconclusive', async t => {
  const contracts = { exampleRoot: './examples', claims: [{ name: 'simple', file: 'entry.mjs', export: 'entry', params: [], args: [], expected: 1 }] };
  const sample = await fixture(t, { contracts, files: { 'entry.mjs': 'export function entry() { return 1; }\n' } });
  const cases = [
    { name: 'unknown', script: '#!/bin/sh\nprintf \'unknown\\n\'\n', expected: 'unknown' },
    { name: 'malformed', script: '#!/bin/sh\nprintf \'maybe\\n\'\n', expected: 'malformed' },
    { name: 'nonzero', script: '#!/bin/sh\nprintf \'unsat\\n\'\nexit 7\n', expected: 'error' },
    { name: 'timeout', script: '#!/bin/sh\nwhile :; do :; done\n', expected: 'timeout', timeoutMs: 25 },
  ];
  for (const item of cases) {
    const fakeSolver = path.join(sample.dir, `fake-z3-${item.name}`);
    await writeFile(fakeSolver, item.script);
    await chmod(fakeSolver, 0o755);
    const result = runVerifier({ ...sample, z3: fakeSolver, timeoutMs: item.timeoutMs });
    assert.equal(result.status, 2, `${item.name} must remain inconclusive`);
    const report = reportOf(result);
    assert.ok(report.obligations.some(obligation => obligation.status === item.expected),
      `expected ${item.name} status ${item.expected}, got ${JSON.stringify(report.obligations)}`);
  }
});
