#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { isPinnedDafnyVersion } = require('./dafny-version.cjs');
const { proverPathArgument, resolveZ3Path } = require('./dafny-solver.cjs');

const root = resolve(dirname(__filename), '..');
const dafny = process.env.DAFNY || process.env.LY_DAFNY || 'dafny';
const z3 = process.env.DAFNY_Z3;
const outputRoot = resolve(process.env.DAFNY_NATIVE_PROOF_OUTPUT || join(root, 'results/dafny-native-proof'));
const output = join(outputRoot, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
const proofRoot = mkdtempSync(join(tmpdir(), 'lightning-yaml-native-proof-'));
const invocations = [];
const sourcePaths = [
  'src/dafny/core/Native.dfy',
  'src/dafny/core/TagValues.dfy',
  'src/dafny/core/Engine.dfy',
  'src/dafny/core/Serializer.dfy',
  'src/dafny/core/SurfaceValues.dfy',
  'src/dafny/core/SurfaceOptions.dfy',
  'src/dafny/core/SurfaceHelpers.dfy',
  'src/dafny/core/SurfaceErrors.dfy',
  'src/dafny/core/SurfaceHost.dfy',
  'src/dafny/core/SurfaceModel.dfy',
  'src/dafny/core/Binary64Scale.dfy',
  'src/dafny/core/NativeBudgetContracts.dfy',
  'src/dafny/core/NativeContracts.dfy',
  'src/dafny/core/FacadeFlow.dfy',
  'src/dafny/core/FacadeContracts.dfy',
  'src/dafny/core/PublicObjects.dfy',
  'src/dafny/core/ObjectsAndErrors.dfy',
  'src/dafny/core/ErrorTranslation.dfy',
  'src/dafny/core/HostObservation.dfy',
  'src/dafny/core/SurfaceWitness.dfy',
  'src/dafny/core/NativeTraceLemmas.dfy',
  'src/dafny/core/NativePhaseIntro.dfy',
  'src/dafny/core/NativePrefixComposition.dfy',
  'src/dafny/core/NativeParseComposition.dfy',
  'src/dafny/core/NativeParseTransport.dfy',
  'src/dafny/core/NativeErrorTextContracts.dfy',
  'src/dafny/surfaces/NativeSurface.dfy',
];
const selected = [
  'NativeSurface.Adapter._ctor',
  'NativeSurface.Adapter.NormalizeParseOptions',
  'NativeSurface.Adapter.SelectCompletionAfterCleanup',
  'NativeSurface.Adapter.Parse',
  'NativeSurface.Adapter.ParseAll',
  'NativeSurface.Adapter.ParseCompletion',
  'NativeSurface.Adapter.Stringify',
  'NativeSurface.Adapter.ExceptionToString',
  'NativeSurface.Adapter.NotImplementedMessage',
  'NativePrefixComposition.Complete',
  'NativeParseComposition.ArraySkip',
  'NativeParseComposition.ArrayHead',
  'NativeParseComposition.NormalizeFailed',
  'NativeParseComposition.ResetFailed',
  'NativeParseComposition.SingleParsed',
  'NativeParseComposition.AllParsed',
  'NativeParseComposition.Cleanup',
  'NativeParseComposition.Finish',
  'NativeParseTransport.ArrayGuardExtension',
  'NativeParseTransport.AfterNormalizationExtension',
  'NativeTraceLemmas.ValuesExtendTransitive',
  'NativeTraceLemmas.ValuesExtend',
  'NativeTraceLemmas.BindingsExtendTransitive',
  'NativeTraceLemmas.BoundTransport',
  'NativeTraceLemmas.TraceValuesExtension',
  'NativeTraceLemmas.TraceValuesConcat',
  'NativeTraceLemmas.TraceAppend',
  'NativeTraceLemmas.TraceLinkedConcat',
  'NativeTraceLemmas.NormalizeAtExtension',
  'NativeTraceLemmas.NormalizationTraceExtension',
  'NativeErrorTextContracts.NotImplementedMessage',
  'Binary64Scale.ScaleSubnormalFraction',
  'Binary64Scale.ScaleSubnormalFractionBound',
  'Binary64Scale.ScaleNumberBy1024',
  'Binary64Scale.ScaleNumberBy1024ProducesValidBits',
  'Binary64Scale.DefaultBudgetEncoding',
  'NativeBudgetContracts.PrimitiveProductBits',
  'NativeBudgetContracts.BudgetOutcomeGuarantees',
  'NativeContracts.DefaultReadyBudgetIsNumber',
  'NativeTraceLemmas.BudgetOutcomeGuaranteesExtension',
  'SurfaceHost.MultiplyBy1024',
  'NativePhaseIntro.PrependFirstOptimizationsRead',
  'NativePhaseIntro.PrependInternStringsRead',
  'NativePhaseIntro.PrependStrictRead',
  'NativePhaseIntro.PrependSecondOptimizationsRead',
  'NativePhaseIntro.PrependBudgetRead',
  'NativePhaseIntro.SkipAbsentOptions',
  'NativePhaseIntro.SkipAbsentFirstOptimizations',
  'NativePhaseIntro.SkipAbsentBudgetOptimizations',
  'NativePhaseIntro.MultiplyLeaf',
];
const filters = [
  '*NativeSurface.Adapter*',
  '*NativePrefixComposition.Complete*',
  '*NativeParseComposition.*',
  '*NativeParseTransport.*',
  '*NativeTraceLemmas.*',
  '*NativePhaseIntro.*',
  '*NativeErrorTextContracts.NotImplementedMessage*',
  '*NativeErrorTextContracts.ExceptionToString*',
  '*Binary64Scale.*',
  '*NativeBudgetContracts.PrimitiveProductBits*',
  '*NativeBudgetContracts.BudgetOutcomeGuarantees*',
  '*NativeContracts.DefaultReadyBudgetIsNumber*',
  '*NativeTraceLemmas.BudgetOutcomeGuaranteesExtension*',
  '*SurfaceHost.MultiplyBy1024*',
];
const zeroVerificationSymbols = [
  { symbol: 'NativeErrorTextContracts.ExceptionToString', filter: '*NativeErrorTextContracts.ExceptionToString*' },
];
const expectedKinds = {
  'NativeSurface.Adapter._ctor': ['correctness'],
  'NativeSurface.Adapter.NormalizeParseOptions': ['correctness', 'well-formedness'],
  'NativeSurface.Adapter.SelectCompletionAfterCleanup': ['correctness'],
  'NativeSurface.Adapter.Parse': ['correctness', 'well-formedness'],
  'NativeSurface.Adapter.ParseAll': ['correctness', 'well-formedness'],
  'NativeSurface.Adapter.ParseCompletion': ['correctness', 'well-formedness'],
  'NativeSurface.Adapter.Stringify': ['correctness', 'well-formedness'],
  'NativeSurface.Adapter.ExceptionToString': ['correctness', 'well-formedness'],
  'NativeSurface.Adapter.NotImplementedMessage': ['correctness', 'well-formedness'],
  'NativePrefixComposition.Complete': ['correctness', 'well-formedness'],
  'NativeParseComposition.ArrayHead': ['correctness', 'well-formedness'],
  'NativeParseComposition.NormalizeFailed': ['correctness', 'well-formedness'],
  'NativeParseComposition.ResetFailed': ['correctness', 'well-formedness'],
  'NativeParseComposition.SingleParsed': ['correctness', 'well-formedness'],
  'NativeParseComposition.AllParsed': ['correctness', 'well-formedness'],
  'NativeParseComposition.Finish': ['correctness'],
  'NativeParseComposition.ArraySkip': ['correctness'],
  'NativeParseComposition.Cleanup': ['correctness'],
  'NativeParseTransport.ArrayGuardExtension': ['correctness'],
  'NativeParseTransport.AfterNormalizationExtension': ['correctness'],
  'NativeTraceLemmas.NormalizeAtExtension': ['correctness', 'well-formedness'],
  'NativeTraceLemmas.NormalizationTraceExtension': ['correctness'],
  'NativeTraceLemmas.TraceValuesExtension': ['correctness'],
  'NativeTraceLemmas.ValuesExtendTransitive': ['correctness'],
  'NativeTraceLemmas.ValuesExtend': ['well-formedness'],
  'NativeTraceLemmas.TraceAppend': ['correctness', 'well-formedness'],
  'NativeTraceLemmas.TraceValuesConcat': ['correctness'],
  'NativeTraceLemmas.TraceLinkedConcat': ['correctness', 'well-formedness'],
  'NativeTraceLemmas.BoundTransport': ['correctness', 'well-formedness'],
  'NativeTraceLemmas.BindingsExtendTransitive': ['correctness'],
  'NativeErrorTextContracts.NotImplementedMessage': ['well-formedness'],
  'Binary64Scale.ScaleSubnormalFraction': ['well-formedness'],
  'Binary64Scale.ScaleSubnormalFractionBound': ['correctness', 'well-formedness'],
  'Binary64Scale.ScaleNumberBy1024': ['well-formedness'],
  'Binary64Scale.ScaleNumberBy1024ProducesValidBits': ['correctness', 'well-formedness'],
  'Binary64Scale.DefaultBudgetEncoding': ['correctness', 'well-formedness'],
  'NativeBudgetContracts.PrimitiveProductBits': ['well-formedness'],
  'NativeBudgetContracts.BudgetOutcomeGuarantees': ['well-formedness'],
  'NativeContracts.DefaultReadyBudgetIsNumber': ['correctness', 'well-formedness'],
  'NativeTraceLemmas.BudgetOutcomeGuaranteesExtension': ['correctness'],
  'SurfaceHost.MultiplyBy1024': ['well-formedness'],
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  invocations.push({
    executable: realpathSync(executable),
    args,
    cwd: root,
    exitCode: result.status,
  });
  if (result.error && result.status !== 0) throw result.error;
  if (result.status !== 0) throw new Error(`Command exited ${result.status ?? 'without an exit code'}\n${result.stdout}\n${result.stderr}`);
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
    } else if (c === '"' && cell.length === 0) quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) throw new Error('Dafny native proof CSV is empty');
  const headers = rows.shift();
  return rows.filter(cells => cells.length).map(cells => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])));
}

function sourceInventory(projectedNativePath) {
  return sourcePaths.map(path => {
    const contents = path === 'src/dafny/core/Native.dfy'
      ? readFileSync(projectedNativePath, 'utf8')
      : readFileSync(join(root, path), 'utf8');
    return { path, sha256: sha256(contents) };
  });
}

function originalSourceHashes() {
  return sourcePaths.map(path => ({
    path,
    sha256: sha256(readFileSync(join(root, path), 'utf8')),
  }));
}

function makeVerifierProjection() {
  const originalPath = join(root, 'src/dafny/core/Native.dfy');
  const original = readFileSync(originalPath, 'utf8');
  const attr = '{:nativeType "number"} ';
  const count = original.split(attr).length - 1;
  if (count !== 3) throw new Error(`Expected exactly three JS-backend nativeType annotations in Native.dfy, found ${count}`);
  const projected = original.replaceAll(attr, '');
  const projectionPath = join(proofRoot, 'Native.verify.dfy');
  writeFileSync(projectionPath, projected);
  return {
    projectionPath,
    sourceHash: sha256(original),
    projectionHash: sha256(projected),
    removedAnnotations: count,
  };
}

function checkResults(rows, selectedNames) {
  const selectedSet = new Set(selectedNames);
  const parsed = rows.map(row => {
    const display = row['TestResult.DisplayName'];
    const match = display.match(/^(.*?) \((well-formedness|correctness)\)(?: \(assertion batch (\d+)\))?$/);
    if (!match) throw new Error(`Malformed Dafny result row: ${display}`);
    return { row, symbol: match[1], kind: match[2], batch: match[3] ?? null };
  });
  const matching = parsed.filter(item => selectedNames.some(name => item.symbol.endsWith(name)));
  if (matching.some(item => item.row['TestResult.Outcome'] !== 'Passed')) {
    const failed = matching.filter(item => item.row['TestResult.Outcome'] !== 'Passed');
    throw new Error(`Native body verification failed: ${failed.map(item => `${item.symbol} ${item.kind} ${item.batch ?? ''}: ${item.row['TestResult.Outcome']}`).join('; ')}`);
  }
  for (const name of selectedNames) {
    const found = matching.filter(item => item.symbol.endsWith(name));
    if (found.length === 0) throw new Error(`Selected Native proof symbol had no verifier result: ${name}`);
    const requiredKinds = expectedKinds[name];
    const observedKinds = [...new Set(found.map(item => item.kind))].sort();
    if (requiredKinds) {
      if (JSON.stringify(observedKinds) !== JSON.stringify([...requiredKinds].sort())) {
        throw new Error(`${name}: expected verification kinds ${requiredKinds.join(',')}, observed ${observedKinds.join(',')}`);
      }
    } else if (!observedKinds.includes('correctness') ||
        observedKinds.some(kind => !['correctness', 'well-formedness'].includes(kind))) {
      throw new Error(`${name}: expected correctness and any observed well-formedness rows, observed ${observedKinds.join(',')}`);
    }
    const ids = found.map(item => `${item.kind}:${item.batch ?? 'single'}`);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate Native assertion batch for ${name}`);
  }
  if (matching.length !== parsed.length) {
    const unexpected = parsed.filter(item => !selectedNames.some(name => item.symbol.endsWith(name)));
    throw new Error(`Selected filters verified unexpected symbols: ${unexpected.map(item => item.symbol).join(', ')}`);
  }
  const observed = new Set(matching.map(item => selectedNames.find(name => item.symbol.endsWith(name))));
  if (observed.size !== selectedSet.size) throw new Error('Native selected-method inventory is incomplete');
  return matching.map(({ symbol, kind, batch, row }) => ({
    symbol, kind, assertionBatch: batch === null ? null : Number(batch),
    outcome: row['TestResult.Outcome'], duration: row['TestResult.Duration'],
    resourceCount: Number(row['TestResult.ResourceCount']),
  }));
}

function matchesFilter(name, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

try {
  if (new Set(selected).size !== selected.length) throw new Error('Duplicate Native proof symbol in inventory');
  const sourceHashesAtStart = originalSourceHashes();
  const compilerVersion = run(dafny, ['--version']).trim();
  if (!isPinnedDafnyVersion(compilerVersion)) throw new Error(`Dafny 4.11.0 required; got ${compilerVersion}`);
  const z3Path = resolveZ3Path(z3);
  const z3Version = run(z3Path, ['--version']).trim();
  if (!/^Z3 version 4\.16\.0\b/.test(z3Version)) throw new Error(`Z3 4.16.0 required; got ${z3Version}`);

  const projection = makeVerifierProjection();
  const paths = sourcePaths.map(path => path === 'src/dafny/core/Native.dfy' ? projection.projectionPath : join(root, path));
  const records = [];
  const logs = [];
  const zeroVcObservations = [];
  mkdirSync(output, { recursive: true });
  for (let index = 0; index < filters.length; index += 1) {
    const filter = filters[index];
    const logPath = join(output, `native-${String(index + 1).padStart(2, '0')}.csv`);
    const filterText = filter.replaceAll('*', '').replace(/\.$/, '');
    const args = [
      'verify', ...paths,
      '--unicode-char:false', '--allow-deprecation', '--isolate-assertions', '--verification-time-limit', '120',
      '--solver-path', z3Path,
      '--log-format', `csv;LogFileName=${logPath}`,
      '--filter-symbol', filterText,
    ];
    const names = selected.filter(name => matchesFilter(name, filter));
    const zeroNames = zeroVerificationSymbols.filter(item => matchesFilter(item.symbol, filter));
    const consoleOutput = run(dafny, args);
    const rows = parseCsv(readFileSync(logPath, 'utf8'));
    const runSummary = consoleOutput.match(/Dafny program verifier finished with (\d+) verified, (\d+) errors?/);
    if (!runSummary || Number(runSummary[1]) !== rows.length || Number(runSummary[2]) !== 0) {
      throw new Error(`Verifier summary does not agree with CSV for ${filter}: ${runSummary?.[0] ?? 'missing summary'}, ${rows.length} rows`);
    }
    if (zeroNames.length > 0 && rows.length !== 0 && names.length === 0) {
      throw new Error(`${filter}: expected zero verification rows for ${zeroNames.map(item => item.symbol).join(', ')}, found ${rows.length}`);
    }
    records.push(...checkResults(rows, names));
    if (zeroNames.length > 0 && rows.length === 0) {
      zeroVcObservations.push({ symbols: zeroNames.map(item => item.symbol), filter, observedCsvRows: 0, source: logPath });
    }
    logs.push({ filter, path: logPath, rowCount: rows.length, verifierArgs: args });
  }
  for (const name of selected) {
    if (!records.some(record => record.symbol.endsWith(name))) throw new Error(`Native proof inventory missing results for ${name}`);
  }

  const evidence = {
    status: 'selected-native-body-batches-passed-dependency-well-formedness-pending',
    completePublicOperations: [],
    compiler: { path: realpathSync(dafny), version: compilerVersion },
    solver: { path: z3Path, version: z3Version, sha256: sha256(readFileSync(z3Path)) },
    projection,
    originalSourceHashes: originalSourceHashes(),
    sourceHashesAtStart,
    zeroVcObservations,
    verifierInputHashes: sourceInventory(projection.projectionPath),
    invocations,
    selectedSymbols: selected,
    filterLogs: logs,
    proofResults: records,
    dependencyInventory: [
      { path: 'src/dafny/core/Native.dfy', status: 'Native.Value/Engine/Writer declarations are compile-time dependencies; not parser/writer semantic proofs' },
      { path: 'src/dafny/core/NativeContracts.dfy', status: 'ghost predicates are specification dependencies; selected bodies prove the routed event composition against these definitions' },
      { path: 'src/dafny/core/NativeContracts.dfy', status: 'specification dependency; trusted/conditional host observations are not implementation proofs here' },
      { path: 'src/dafny/core/SurfaceHost.dfy', status: 'host-open atomic observation bindings and completion projections; no standalone implementation proof is claimed' },
      { path: 'src/dafny/core/NativeErrorTextContracts.dfy', status: 'error-text trace predicates; string concatenation correspondence is the separately trusted Native.Concat law' },
      { path: 'src/dafny/core/Binary64Scale.dfy', status: 'independent integer IEEE-754 scaling model; host binary64 correspondence remains open' },
      { path: 'src/dafny/core/NativeBudgetContracts.dfy', status: 'conditional budget-result relation; LanguageTypeError classification and JS conversion hooks are HOST-OPEN' },
      { path: 'src/dafny/core/SurfaceModel.dfy', status: 'ghost model definitions; full YAML relation remains open' },
      { path: 'src/dafny/core/SurfaceWitness.dfy', status: 'protected-context capability is host-open; authenticity is not established by this proof' },
      { path: 'src/dafny/core/FacadeContracts.dfy', status: 'model contract dependencies; not complete public-operation guarantees' },
    ],
    dependencyWellFormedness: [
      { path: 'src/dafny/core/NativeContracts.dfy', status: 'pending selected WF/termination replay for ghost predicates' },
      { path: 'src/dafny/core/Binary64Scale.dfy', status: 'selected arithmetic declarations and lemmas have explicit WF/correctness inventory rows; this is not a full model WF proof' },
      { path: 'src/dafny/core/NativeBudgetContracts.dfy', status: 'selected conditional budget predicates have explicit WF inventory rows; HOST-OPEN classifier is not a body proof' },
      { path: 'src/dafny/core/SurfaceHost.dfy', symbol: 'MultiplyBy1024', status: 'selected WF rows only; other host atomic specifications remain pending WF inventory' },
      { path: 'src/dafny/core/NativeErrorTextContracts.dfy', status: 'the selected error-text predicates have explicit WF-only rows; their supporting model dependencies still require a separate WF inventory' },
      { path: 'src/dafny/core/SurfaceHost.dfy', status: 'pending selected WF replay for atomic observation specifications and projections' },
      { path: 'src/dafny/core/SurfaceModel.dfy', status: 'pending selected WF replay for model functions and predicates' },
      { path: 'src/dafny/core/SurfaceWitness.dfy', status: 'pending selected WF replay; ProtectedContextAccess remains HOST-OPEN' },
      { path: 'src/dafny/core/FacadeContracts.dfy', status: 'pending selected WF replay for contract definitions' },
    ],
    trustedBoundary: 'Atomic SurfaceHost observations and ProtectedContextAccess are host-open conditional contracts; this gate verifies routed Native bodies and listed proof helpers only.',
    knownGap: 'The conditional model relates default, Number, and Boolean inputs to budget results. Exact JavaScript number representation, string/reference coercion, BigInt/Symbol TypeError classification, and host binding remain open.',
    semanticLimit: 'No end-to-end YAML parse/stringify operation is claimed as formally verified.',
  };
  if (JSON.stringify(sourceHashesAtStart) !== JSON.stringify(originalSourceHashes())) {
    throw new Error('Dafny source inputs changed during Native proof replay');
  }
  writeFileSync(join(output, 'coverage.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`Verified ${records.length} Native proof obligations across ${selected.length} selected symbols.\nEvidence: ${join(output, 'coverage.json')}\n`);
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
} finally {
  rmSync(proofRoot, { recursive: true, force: true });
}
