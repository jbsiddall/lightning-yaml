'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  mkdirSync, readFileSync, realpathSync, writeFileSync,
} = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { isPinnedDafnyVersion } = require('./dafny-version.cjs');
const { proverPathArgument, resolveZ3Path } = require('./dafny-solver.cjs');

const root = resolve(dirname(__filename), '..');
const dafny = process.env.DAFNY || process.env.LY_DAFNY || 'dafny';
const outputRoot = resolve(process.env.DAFNY_OPTIONS_PROOF_OUTPUT || join(root, 'results/dafny-options-proof'));
const output = join(outputRoot, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
const sources = [
  'src/dafny/core/Native.dfy',
  'src/dafny/core/SurfaceValues.dfy',
  'src/dafny/core/SurfaceOptions.dfy',
];
const EXPECTED_POLICY_HASHES = {
  'src/dafny/core/SurfaceValues.dfy': '35b03a7a3c20a5b0949d9068fa295ad56f3f54f3a338ae7ca766debcd00f3685',
  'src/dafny/core/SurfaceOptions.dfy': '8d3715620ed8b7f112d47d5280a75a6dc99dd02a4d48dc3ae9aa5c74c4429d22',
};
const methods = [
  'SelectYamlParseOptions',
  'SelectYamlStringifyOptions',
  'SelectJsYamlLoadAllOptions',
  'RejectYamlOptionsPrimitive',
  'RejectRecognizedOption',
];
const expectedKinds = {
  SelectYamlParseOptions: ['correctness'],
  SelectYamlStringifyOptions: ['correctness'],
  SelectJsYamlLoadAllOptions: ['correctness'],
  RejectYamlOptionsPrimitive: ['correctness'],
  RejectRecognizedOption: ['correctness', 'well-formedness'],
};
const mutations = [
  {
    method: 'SelectYamlParseOptions',
    id: 'mutation-01-parse-third-slot',
    label: 'removing the present-third-argument guard',
    from: 'useSecond := thirdUndefined && !secondFunction && secondTruthy;',
    to: 'useSecond := !secondFunction && secondTruthy;',
  },
  {
    method: 'SelectYamlStringifyOptions',
    id: 'mutation-02-stringify-array-slot',
    label: 'ignoring an array in the second argument slot',
    from: 'useSecond := thirdUndefined && !(secondFunction || secondArray) && secondTruthy;',
    to: 'useSecond := thirdUndefined && !secondFunction && secondTruthy;',
  },
  {
    method: 'SelectJsYamlLoadAllOptions',
    id: 'mutation-03-loadall-slot',
    label: 'rejecting the object second-slot selection',
    from: 'useSecond := secondObject;',
    to: 'useSecond := false;',
  },
  {
    method: 'RejectYamlOptionsPrimitive',
    id: 'mutation-04-yaml-nullish',
    label: 'rejecting a loosely-nullish options value',
    from: 'reject := !looselyNullish && !objectType;',
    to: 'reject := !objectType;',
  },
  {
    method: 'RejectRecognizedOption',
    id: 'mutation-05-exact-true',
    label: 'using truthiness instead of exact true for code 3',
    from: 'else if code == 3 { reject := !exactlyTrue; }',
    to: 'else if code == 3 { reject := !truthyValue; }',
  },
  {
    method: 'RejectRecognizedOption',
    id: 'mutation-06-every-defined',
    label: 'accepting falsy defined values for code 4',
    from: 'else if code == 4 { reject := true; }',
    to: 'else if code == 4 { reject := truthyValue; }',
  },
  {
    method: 'RejectRecognizedOption',
    id: 'mutation-07-core-identity',
    label: 'accepting truthy non-core values for code 2',
    from: 'else if code == 2 { reject := !coreSchemaIdentity; }',
    to: 'else if code == 2 { reject := !(coreSchemaIdentity || (truthyValue && !exactlyTrue && !coreText && !version12Text)); }',
  },
  {
    method: 'RejectRecognizedOption',
    id: 'mutation-08-truthy-feature',
    label: 'requiring exact true instead of truthiness for code 5',
    from: 'else if code == 5 { reject := truthyValue; }',
    to: 'else if code == 5 { reject := exactlyTrue; }',
  },
  {
    method: 'RejectRecognizedOption',
    id: 'mutation-09-core-text',
    label: 'using truthiness instead of the exact core text for code 6',
    from: 'else if code == 6 { reject := !coreText; }',
    to: 'else if code == 6 { reject := !truthyValue; }',
  },
  {
    method: 'RejectRecognizedOption',
    id: 'mutation-10-version-text',
    label: 'using truthiness instead of the exact version text for code 7',
    from: 'else { reject := !version12Text; }',
    to: 'else { reject := !truthyValue; }',
  },
];

function assertMethodInventory(names) {
  if (new Set(names).size !== names.length) throw new Error('Duplicate method in expected policy inventory');
}

function assertMutationInventory(items) {
  if (new Set(items.map(mutation => mutation.id)).size !== items.length) throw new Error('Duplicate mutation output id');
  if (items.some(mutation => !methods.includes(mutation.method) || !/^mutation-\d{2}-[a-z0-9-]+$/.test(mutation.id))) throw new Error('Invalid mutation inventory entry');
}

function assertInventory() {
  assertMethodInventory(methods);
  assertMutationInventory(mutations);
  if (JSON.stringify(Object.keys(expectedKinds).sort()) !== JSON.stringify([...methods].sort())) throw new Error('Expected obligation inventory differs from selected method inventory');
  for (const [name, kinds] of Object.entries(expectedKinds)) {
    if (new Set(kinds).size !== kinds.length || kinds.some(kind => !['well-formedness', 'correctness'].includes(kind))) throw new Error(`Invalid verification kinds for ${name}`);
  }
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function run(executable, args, { expectedFailure = false } = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error && !result.stdout && !result.stderr) throw result.error;
  if (expectedFailure ? result.status !== 4 : result.status !== 0) {
    throw new Error(`Dafny ${expectedFailure ? 'mutation' : 'verification'} exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) throw new Error('Dafny CSV log is empty');
  const headers = rows.shift();
  return rows.filter(cells => cells.length).map(cells => Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ''])));
}

function verifyArgs(logPath, pattern, z3Path) {
  return [
    '/unicodeChar:0', '/compileTarget:js', '/compile:0', '/timeLimit:60',
    proverPathArgument(z3Path),
    `/verificationLogger:csv;LogFileName=${logPath}`,
    `/proc:${pattern}`,
    ...sources,
  ];
}

function selectRows(logPath, stdout, selectedMethods, expectedFailure = false) {
  const rows = parseCsv(readFileSync(logPath, 'utf8'));
  const allowed = new Set(selectedMethods.map(name => `SurfaceOptions.${name}`));
  const parsed = rows.map(row => {
    const match = row['TestResult.DisplayName'].match(/^(.*?) \(([^()]*)\)$/);
    if (!match) throw new Error(`Malformed verification symbol ${row['TestResult.DisplayName']}`);
    return { row, name: match[1], kind: match[2] };
  });
  if (parsed.some(entry => !allowed.has(entry.name))) throw new Error(`Unexpected selected Dafny symbol: ${parsed.map(entry => entry.name).join(', ')}`);
  for (const name of selectedMethods) {
    const found = parsed.filter(entry => entry.name === `SurfaceOptions.${name}`);
    const kinds = found.map(entry => entry.kind).sort();
    const expected = [...expectedKinds[name]].sort();
    if (JSON.stringify(kinds) !== JSON.stringify(expected)) throw new Error(`${name}: expected obligations ${expected.join(', ')}, observed ${kinds.join(', ')}`);
    if (found.some(entry => entry.row['TestResult.Outcome'] !== (expectedFailure && entry.kind === 'correctness' ? 'Failed' : 'Passed'))) {
      throw new Error(`${name}: a verification obligation had an unexpected outcome`);
    }
  }
  const summary = stdout.match(/Dafny program verifier finished with (\d+) verified, (\d+) errors?/);
  const count = Number(summary?.[1]), errors = Number(summary?.[2]);
  const passed = parsed.filter(entry => entry.row['TestResult.Outcome'] === 'Passed').length;
  const failed = parsed.filter(entry => entry.row['TestResult.Outcome'] === 'Failed').length;
  if (!summary || count !== passed || errors !== (expectedFailure ? failed : 0)) throw new Error('Dafny console summary did not match its CSV results');
  return parsed;
}

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one exact mutation target, found ${count}`);
  return text.replace(from, to);
}

function assertPolicySourceHashes(contents) {
  for (const [filename, expected] of Object.entries(EXPECTED_POLICY_HASHES)) {
    if (sha256(contents[filename]) !== expected) throw new Error(`Pinned options/model definition changed: ${filename}`);
  }
}

function selfCheckInventoryAndPins() {
  const duplicateMethods = [...methods, methods[0]];
  let rejectedDuplicateMethod = false;
  try { assertMethodInventory(duplicateMethods); }
  catch (error) {
    if (/Duplicate method/.test(error.message)) rejectedDuplicateMethod = true;
    else throw error;
  }
  if (!rejectedDuplicateMethod) throw new Error('Duplicate-method fixture was not rejected by unique membership check');
  const duplicateMutations = [...mutations, mutations[0]];
  let rejectedDuplicateMutation = false;
  try { assertMutationInventory(duplicateMutations); }
  catch (error) {
    if (/Duplicate mutation output id/.test(error.message)) rejectedDuplicateMutation = true;
    else throw error;
  }
  if (!rejectedDuplicateMutation) throw new Error('Duplicate-mutation fixture was not rejected by unique output check');
  const originals = Object.fromEntries(Object.keys(EXPECTED_POLICY_HASHES).map(file => [file, readFileSync(join(root, file))]));
  assertPolicySourceHashes(originals);
  const optionsPath = 'src/dafny/core/SurfaceOptions.dfy';
  const weakenedRule = originals[optionsPath].toString().replace(
    'else if code == 6 then !V.IsCoreText(value)',
    'else if code == 6 then false',
  );
  if (weakenedRule === originals[optionsPath].toString()) throw new Error('RuleRejects weakening fixture did not alter its target');
  const weakened = { ...originals, [optionsPath]: Buffer.from(weakenedRule) };
  try { assertPolicySourceHashes(weakened); }
  catch (error) {
    if (/Pinned options\/model definition changed/.test(error.message)) return;
    throw error;
  }
  throw new Error('Changed policy/model source fixture was not rejected by the pinned inventory');
}

function main() {
  assertInventory();
  selfCheckInventoryAndPins();
  const z3Path = resolveZ3Path();
  const versionText = run(dafny, ['--version']);
  if (!isPinnedDafnyVersion(versionText.trim())) throw new Error(`Dafny 4.11.0 required, received ${versionText.trim()}`);
  const z3Version = run(z3Path, ['--version']);
  if (!/Z3 version 4\.16\.0(?:\s|$)/m.test(z3Version)) throw new Error(`Z3 4.16.0 required, received ${z3Version.trim()}`);
  mkdirSync(output, { recursive: true });

  const allLog = join(output, 'policy-obligations.csv');
  const allOutput = run(dafny, verifyArgs(allLog, '*SurfaceOptions*', z3Path));
  writeFileSync(join(output, 'policy-obligations.stdout.txt'), allOutput);
  const selected = selectRows(allLog, allOutput, methods);
  if (selected.length !== 6) throw new Error(`Expected six proof obligations for five methods, found ${selected.length}`);

  const sourceText = readFileSync(join(root, 'src/dafny/core/SurfaceOptions.dfy'), 'utf8');
  const mutationResults = [];
  for (const mutation of mutations) {
    const directory = join(output, mutation.id);
    mkdirSync(directory, { recursive: true });
    const mutatedPath = join(directory, 'Options.dfy');
    writeFileSync(mutatedPath, replaceOnce(sourceText, mutation.from, mutation.to, mutation.id));
    const logPath = join(directory, 'verification.csv');
    const args = verifyArgs(logPath, `*${mutation.method}*`, z3Path).map(arg => arg === 'src/dafny/core/SurfaceOptions.dfy' ? mutatedPath : arg);
    const outputText = run(dafny, args, { expectedFailure: true });
    writeFileSync(join(directory, 'verifier.stdout.txt'), outputText);
    const rows = selectRows(logPath, outputText, [mutation.method], true);
    if (rows.filter(row => row.row['TestResult.Outcome'] === 'Failed').length !== 1) throw new Error(`${mutation.id}: weakened decision was not rejected exactly once`);
    mutationResults.push({ id: mutation.id, mutation: mutation.label, outcome: 'correctness proof failed as expected', verificationRows: rows.map(({ name, kind, row }) => ({ symbol: name, kind, outcome: row['TestResult.Outcome'] })) });
  }

  const sourceHashes = Object.fromEntries(sources.map(file => [file, sha256(readFileSync(join(root, file)))]));
  const runtime = readFileSync(join(root, 'src/dafny/generated/engine.js'));
  const runtimeHeader = runtime.toString('utf8').match(/^\/\/ Sources sha256 ([0-9a-f]{64});/m);
  const compilerPath = realpathSync(dafny.includes('/') ? dafny : spawnSync('which', [dafny], { encoding: 'utf8' }).stdout.trim());
  const report = {
    schemaVersion: 1,
    compiler: { version: versionText.trim(), executable: compilerPath, executableSha256: sha256(readFileSync(compilerPath)) },
    solver: { version: z3Version.trim(), executable: z3Path, executableSha256: sha256(readFileSync(z3Path)) },
    options: { target: 'js', unicodeChar: false, compile: false, verificationTimeLimitSeconds: 60, selectedProcedurePattern: '*SurfaceOptions*' },
    sources: sourceHashes,
    generatedRuntime: { path: 'src/dafny/generated/engine.js', sha256: sha256(runtime), sourceHeaderSha256: runtimeHeader?.[1] ?? null },
    verifiedMethods: selected.map(({ name, kind, row }) => ({ name, kind, outcome: row['TestResult.Outcome'], duration: row['TestResult.Duration'], resourceCount: Number(row['TestResult.ResourceCount']) })),
    methodCount: methods.length,
    proofObligationCount: selected.length,
    ghostModelDefinitions: {
      sourcePinned: ['SurfaceValues.OptionSurface', 'SurfaceValues.Argument', 'SurfaceValues.Truthy', 'SurfaceValues.IsCoreSchema', 'SurfaceValues.IsLooselyNullishArgument', 'SurfaceOptions.RuleRejects', 'SurfaceOptions.OwnRuleCode'],
      zeroVcObservation: 'The broad *SurfaceOptions* selection emitted no row for ghost function OwnRuleCode; it is not reported as a semantic proof.',
    },
    mutationChecks: mutationResults,
    assuranceScope: 'The five executable selector/decision methods have conditional Dafny correctness proofs under their declared ghost-to-runtime classifier correspondence requirements. Host classification, JavaScript completion identity, option getter/proxy effects, full validation behavior, and parser/writer semantics remain outside these proofs.',
    outputDirectory: output,
  };
  writeFileSync(join(output, 'coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Dafny options policy proof passed: ${methods.length} methods, ${selected.length} obligations, ${mutationResults.length} rejected mutations\n${output}\n`);
}

try { main(); }
catch (error) { process.stderr.write(`Dafny options verification: ${error.message}\n`); process.exitCode = 1; }
