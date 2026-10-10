#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { isPinnedDafnyVersion } = require('./dafny-version.cjs');

const root = resolve(dirname(__filename), '..');
const dafny = process.env.DAFNY || 'dafny';
const z3 = process.env.DAFNY_Z3 || 'z3';
const enginePath = resolve(process.env.DAFNY_SCANNER_ENGINE || join(root, 'src/dafny/core/Engine.dfy'));
const outputRoot = resolve(process.env.DAFNY_SCANNER_PROOF_OUTPUT || join(root, 'results/dafny-scanner-proof'));
const output = join(outputRoot, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
const methods = [
  'FlowSeparatorAt',
  'ScanFlowPlainLine',
  'TrimTrailingWs',
  'SkipInlineSpaces',
  'IsSpaceOrEolAt',
  'IsSpaceOrEol',
  'IsDocMarkerAt',
  'LooksLikeDocMarkerAt',
];
const dependencies = [
  'FlowIndicator',
  'InlineWs',
  'LineBreak',
  'FlowDelimiter',
  'SeparatorChar',
  'SeparatorAt',
  'PlainStop',
  'PlainPrefix',
  'FirstPlainStop',
  'WsRange',
  'TrimmedEnd',
  'FirstNonInlineWs',
  'CharFlowDelimiter',
  'PrefixExtend',
  'WsRangeExtendLeft',
  'SpaceOrEolBoundaryAt',
  'DocumentMarkerAt',
];
const expectedKinds = {
  FlowSeparatorAt: ['well-formedness', 'correctness'],
  ScanFlowPlainLine: ['well-formedness', 'correctness'],
  TrimTrailingWs: ['well-formedness', 'correctness'],
  SkipInlineSpaces: ['well-formedness', 'correctness'],
  FlowIndicator: ['well-formedness'],
  InlineWs: [],
  LineBreak: [],
  FlowDelimiter: [],
  SeparatorChar: [],
  SeparatorAt: ['well-formedness'],
  PlainStop: ['well-formedness'],
  PlainPrefix: ['well-formedness'],
  FirstPlainStop: ['well-formedness'],
  WsRange: ['well-formedness'],
  TrimmedEnd: ['well-formedness'],
  FirstNonInlineWs: ['well-formedness'],
  CharFlowDelimiter: ['well-formedness', 'correctness'],
  PrefixExtend: ['well-formedness', 'correctness'],
  WsRangeExtendLeft: ['well-formedness', 'correctness'],
  IsSpaceOrEolAt: ['well-formedness', 'correctness'],
  IsSpaceOrEol: ['well-formedness', 'correctness'],
  IsDocMarkerAt: ['well-formedness', 'correctness'],
  LooksLikeDocMarkerAt: ['well-formedness', 'correctness'],
  SpaceOrEolBoundaryAt: ['well-formedness'],
  DocumentMarkerAt: ['well-formedness'],
};
const verificationGroups = [
  { names: ['FlowSeparatorAt', 'SeparatorAt'], pattern: '*SeparatorAt*' },
  ...methods.filter((name) => name !== 'FlowSeparatorAt' && name !== 'IsSpaceOrEolAt' && name !== 'IsSpaceOrEol')
    .map((name) => ({ names: [name], pattern: `*${name}*` })),
  { names: ['IsSpaceOrEolAt', 'IsSpaceOrEol'], pattern: '*IsSpaceOrEol*' },
  { names: ['FlowIndicator'], pattern: '*FlowIndicator*' },
  { names: ['InlineWs', 'FirstNonInlineWs'], pattern: '*InlineWs*' },
  { names: ['LineBreak'], pattern: '*LineBreak*' },
  { names: ['FlowDelimiter', 'CharFlowDelimiter'], pattern: '*FlowDelimiter*' },
  { names: ['SeparatorChar'], pattern: '*SeparatorChar*' },
  { names: ['PlainStop', 'FirstPlainStop'], pattern: '*PlainStop*' },
  { names: ['PlainPrefix'], pattern: '*PlainPrefix*' },
  { names: ['WsRange', 'WsRangeExtendLeft'], pattern: '*WsRange*' },
  { names: ['TrimmedEnd'], pattern: '*TrimmedEnd*' },
  { names: ['PrefixExtend'], pattern: '*PrefixExtend*' },
  { names: ['SpaceOrEolBoundaryAt'], pattern: '*SpaceOrEolBoundaryAt*' },
  { names: ['DocumentMarkerAt'], pattern: '*DocumentMarkerAt*' },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell.length === 0) {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  if (!rows.length) throw new Error('Dafny CSV log is empty');
  const headers = rows.shift();
  return rows.filter((cells) => cells.length).map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ''])));
}

function run(args, options = {}, executable = dafny) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error && (result.status !== 0 || (!result.stdout && !result.stderr))) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Dafny exited ${result.status ?? 'without an exit code'}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function runExpectedVerificationFailure(args) {
  const result = spawnSync(dafny, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error && (result.status !== 4 || (!result.stdout && !result.stderr))) throw result.error;
  if (result.status !== 4) throw new Error(`Expected a selected verification failure, got exit ${result.status}:\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

function recordSelection(csvPath, consoleLog, names, pattern) {
  const expectedRows = names.reduce((count, name) => count + expectedKinds[name].length, 0);
  let rows = [];
  try {
    const csv = readFileSync(csvPath, 'utf8');
    rows = csv.trim() ? parseCsv(csv) : [];
  } catch (error) {
    if (error.code !== 'ENOENT' || expectedRows !== 0) throw error;
  }
  const parsed = rows.map((row) => {
    const match = row['TestResult.DisplayName'].match(/^(.*?) \(([^()]*)\)$/);
    if (!match) throw new Error(`Malformed Dafny result symbol: ${row['TestResult.DisplayName']}`);
    return { row, name: match[1], kind: match[2] };
  });
  const expectedNames = new Set(names.map((name) => `DafnyCore.Engine.${name}`));
  if (parsed.some(({ name }) => !expectedNames.has(name))) throw new Error(`CSV contains an unexpected selected symbol: ${parsed.map(({ name }) => name).join(', ')}`);
  if (parsed.some(({ row }) => row['TestResult.Outcome'] !== 'Passed')) {
    throw new Error('A selected verification result is not Passed');
  }
  for (const name of names) {
    const fullName = `DafnyCore.Engine.${name}`;
    const symbolRows = parsed.filter((entry) => entry.name === fullName);
    if (new Set(symbolRows.map((entry) => entry.kind)).size !== symbolRows.length) throw new Error(`${name}: duplicate verification result row`);
    const observedKinds = symbolRows.map((entry) => entry.kind).sort();
    const expected = [...expectedKinds[name]].sort();
    if (JSON.stringify(observedKinds) !== JSON.stringify(expected)) {
      throw new Error(`${name}: expected result kinds ${expected.join(',') || '(no proof obligations)'}, observed ${observedKinds.join(',') || '(none)'}`);
    }
  }
  const summary = consoleLog.match(/Dafny program verifier finished with (\d+) verified, (\d+) errors?/);
  const count = Number(summary?.[1]);
  const errors = Number(summary?.[2]);
  if (!Number.isInteger(count) || errors !== 0 || count !== parsed.length || count === 0) {
    if (!(summary && expectedRows === 0 && count === 0 && errors === 0 && parsed.length === 0)) {
      throw new Error(`Verifier summary for ${pattern} does not match selected CSV rows (${count} verified, ${errors} errors, ${parsed.length} rows)`);
    }
  }
  return names.map((name) => {
    const fullName = `DafnyCore.Engine.${name}`;
    const found = parsed.filter((entry) => entry.name === fullName);
    return {
      name: fullName,
      status: expectedKinds[name].length ? 'verified' : 'no-verification-conditions',
      procedureFilters: [`/proc:${pattern}`],
      proofObligations: found.map(({ row, kind }) => ({
        kind,
        outcome: row['TestResult.Outcome'],
        duration: row['TestResult.Duration'],
        resourceCount: Number(row['TestResult.ResourceCount']),
      })),
      log: resolve(csvPath),
    };
  });
}

function methodSection(source, name) {
  const start = source.indexOf(`method ${name}(`);
  if (start < 0) throw new Error(`Method not found: ${name}`);
  const body = source.indexOf('\n    {', start);
  if (body < 0) throw new Error(`Method body not found: ${name}`);
  return source.slice(start, body).replace(/\s+/g, ' ');
}

function replaceExactlyOnceInMethod(source, name, from, to) {
  const start = source.indexOf(`method ${name}(`);
  if (start < 0) throw new Error(`${name}: mutation method not found`);
  const next = source.indexOf('\n    method ', start + 1);
  const end = next < 0 ? source.length : next;
  const section = source.slice(start, end);
  const occurrences = section.split(from).length - 1;
  if (occurrences !== 1) throw new Error(`${name}: expected exactly one mutation target, found ${occurrences}: ${from}`);
  return source.slice(0, start) + section.replace(from, to) + source.slice(end);
}

function expectContractInventoryRejection(source, expectedMessage, label) {
  try {
    requireContracts(source);
  } catch (error) {
    if (String(error.message).includes(expectedMessage)) return;
    throw new Error(`${label}: rejected for an unexpected reason: ${error.message}`);
  }
  throw new Error(`${label}: weakened specification unexpectedly passed the contract inventory`);
}

function requireContracts(source) {
  const expected = {
    FlowSeparatorAt: [
      'requires i as int <= len as int',
      'requires len as int == |src|',
      'ensures yes == SeparatorAt(src, i as int)',
    ],
    ScanFlowPlainLine: [
      'requires from as int <= len as int',
      'requires len as int == |src|',
      'ensures FirstPlainStop(src, from as int, p as int)',
    ],
    TrimTrailingWs: [
      'requires from <= end && end <= len',
      'requires len as int == |src|',
      'ensures TrimmedEnd(src, from as int, end as int, p as int)',
    ],
    SkipInlineSpaces: [
      'requires len as int == |src|',
      'requires pos <= len',
      'modifies this`pos',
      'ensures old(pos) <= pos <= len',
      'ensures FirstNonInlineWs(src, old(pos) as int, pos as int)',
    ],
    IsSpaceOrEolAt: [
      'requires i <= len',
      'requires len as int == |src|',
      'ensures yes == SpaceOrEolBoundaryAt(src, i as int)',
    ],
    IsSpaceOrEol: [
      'ensures yes == (InlineWs(c as char) || LineBreak(c as char))',
    ],
    IsDocMarkerAt: [
      'requires i <= len',
      'requires len as int == |src|',
      'requires i != lineStart || (i as int) + 2 < 9007199254740000',
      'ensures yes == DocumentMarkerAt(src, lineStart as int, i as int)',
    ],
    LooksLikeDocMarkerAt: [
      'requires i <= len',
      'requires len as int == |src|',
      'requires (i as int) + 2 < 9007199254740000',
      'ensures yes == DocumentMarkerAt(src, i as int, i as int)',
    ],
  };
  for (const [name, clauses] of Object.entries(expected)) {
    const section = methodSection(source, name);
    for (const clause of clauses) {
      if (!section.includes(clause)) throw new Error(`${name}: required contract missing: ${clause}`);
    }
  }
  for (const [name, invariant] of [
    ['ScanFlowPlainLine', 'invariant PlainPrefix(src, from as int, p as int)'],
    ['TrimTrailingWs', 'invariant WsRange(src, p as int, end as int)'],
    ['SkipInlineSpaces', 'invariant WsRange(src, begin as int, pos as int)'],
  ]) {
    const start = source.indexOf(`method ${name}(`);
    const next = source.indexOf('\n    method ', start + 1);
    const section = source.slice(start, next < 0 ? source.length : next).replace(/\s+/g, ' ');
    if (!section.includes(invariant)) throw new Error(`${name}: required loop invariant missing: ${invariant}`);
  }
  const ghostDefinitions = [
    "ghost predicate InlineWs(c: char) reads {} { c == ' ' || c == '\\t' }",
    "ghost predicate LineBreak(c: char) reads {} { c == '\\n' || c == '\\r' }",
    'ghost predicate SpaceOrEolBoundaryAt(s: string, i: int) reads {} requires 0 <= i <= |s| { i == |s| || InlineWs(s[i]) || LineBreak(s[i]) }',
    "ghost predicate DocumentMarkerAt(s: string, start: int, i: int) reads {} requires 0 <= i <= |s| { i == start && i + 3 <= |s| && (s[i] == '-' || s[i] == '.') && s[i + 1] == s[i] && s[i + 2] == s[i] && SpaceOrEolBoundaryAt(s, i + 3) }",
    "ghost predicate FlowDelimiter(c: char) reads {} { c == ',' || c == '[' || c == ']' || c == '{' || c == '}' }",
    'ghost predicate SeparatorChar(c: char) reads {} { InlineWs(c) || LineBreak(c) || FlowDelimiter(c) }',
    'ghost predicate SeparatorAt(s: string, i: int) reads {} requires 0 <= i <= |s| { i == |s| || SeparatorChar(s[i]) }',
    'ghost predicate PlainStop(s: string, start: int, i: int) reads {} requires 0 <= start <= i < |s| { FlowDelimiter(s[i]) || LineBreak(s[i]) || (s[i] == \':\' && SeparatorAt(s, i + 1)) || (s[i] == \'#\' && start < i && InlineWs(s[i - 1])) }',
    'ghost predicate PlainPrefix(s: string, start: int, end: int) reads {} requires 0 <= start <= end <= |s| { forall k: int | start <= k < end :: !PlainStop(s, start, k) }',
    'ghost predicate FirstPlainStop(s: string, start: int, end: int) reads {} requires 0 <= start <= end <= |s| { PlainPrefix(s, start, end) && (end == |s| || PlainStop(s, start, end)) }',
    'ghost predicate WsRange(s: string, start: int, end: int) reads {} requires 0 <= start <= end <= |s| { forall k: int | start <= k < end :: InlineWs(s[k]) }',
    'ghost predicate TrimmedEnd(s: string, from: int, end: int, p: int) reads {} requires 0 <= from <= p <= end <= |s| { WsRange(s, p, end) && (p == from || !InlineWs(s[p - 1])) }',
    'ghost predicate FirstNonInlineWs(s: string, from: int, p: int) reads {} requires 0 <= from <= p <= |s| { WsRange(s, from, p) && (p == |s| || !InlineWs(s[p])) }',
    'lemma CharFlowDelimiter(c: char) ensures FlowDelimiter(c) == FlowIndicator(c as Unit)',
    'lemma PrefixExtend(s: string, start: int, p: int) requires 0 <= start <= p < |s| requires PlainPrefix(s, start, p) && !PlainStop(s, start, p) ensures PlainPrefix(s, start, p + 1)',
    'lemma WsRangeExtendLeft(s: string, from: int, p: int, end: int) requires 0 <= from < p <= end <= |s| requires WsRange(s, p, end) && InlineWs(s[p - 1]) ensures WsRange(s, p - 1, end)',
  ];
  const normalized = source.replace(/\s+/g, ' ');
  for (const fragment of ghostDefinitions) {
    if (!normalized.includes(fragment)) throw new Error(`Scanner specification definition changed or weakened: ${fragment}`);
  }
}

function checkMutationLog(logPath, consoleLog, expectedSymbol, selectedSymbols = [expectedSymbol]) {
  const rows = parseCsv(readFileSync(logPath, 'utf8'));
  const targetName = `DafnyCore.Engine.${expectedSymbol}`;
  const expectedRows = selectedSymbols.reduce((count, name) => count + expectedKinds[name].length, 0);
  const names = new Set(selectedSymbols.map((name) => `DafnyCore.Engine.${name}`));
  if (rows.length !== expectedRows || rows.some((row) => {
    const match = row['TestResult.DisplayName'].match(/^(.*?) \(([^()]*)\)$/);
    return !match || !names.has(match[1]);
  })) {
    throw new Error(`${expectedSymbol} mutation: verifier did not report the exact selected obligations`);
  }
  const outcomes = new Map(rows.map((row) => {
    const [, name, kind] = row['TestResult.DisplayName'].match(/^(.*?) \(([^()]*)\)$/);
    return [`${name}#${kind}`, row['TestResult.Outcome']];
  }));
  for (const name of selectedSymbols) {
    for (const kind of expectedKinds[name]) {
      const expected = `DafnyCore.Engine.${name}` === targetName && kind === 'correctness'
        ? 'Failed'
        : 'Passed';
      if (outcomes.get(`DafnyCore.Engine.${name}#${kind}`) !== expected) {
        throw new Error(`${expectedSymbol} mutation: ${name} ${kind} expected ${expected}`);
      }
    }
  }
  const summary = consoleLog.match(/Dafny program verifier finished with (\d+) verified, (\d+) errors?/);
  const expectedPassed = expectedRows - 1;
  if (!summary || Number(summary[2]) !== 1 || Number(summary[1]) !== expectedPassed) {
    throw new Error(`${expectedSymbol} mutation: verifier summary was not ${expectedPassed} verified, 1 error`);
  }
  return { symbol: targetName, wellFormedness: 'Passed', correctness: 'Failed as expected', log: resolve(logPath) };
}

function validateGroupMembership(groups, expectedSymbols) {
  if (new Set(expectedSymbols).size !== expectedSymbols.length) {
    throw new Error('Configured symbol inventory contains a duplicate name');
  }
  const expected = new Set(expectedSymbols);
  const counts = new Map();
  for (const group of groups) {
    for (const name of group.names) {
      if (!expected.has(name)) throw new Error(`Unknown selected symbol in verification groups: ${name}`);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const mismatched = [...expected].filter((name) => counts.get(name) !== 1);
  if (mismatched.length) {
    throw new Error(`Verification group membership must select every configured symbol exactly once; missing or duplicate: ${mismatched.join(', ')}`);
  }
  return [...counts.keys()];
}

function checkDuplicateGroupFixture() {
  const fixture = [...verificationGroups, { ...verificationGroups[0], names: [...verificationGroups[0].names] }];
  try {
    validateGroupMembership(fixture, [...methods, ...dependencies]);
  } catch (error) {
    if (/exactly once/.test(String(error))) return;
    throw error;
  }
  throw new Error('Duplicate verification-group fixture was not rejected');
}

function checkDuplicateInventoryFixture() {
  try {
    validateGroupMembership(verificationGroups, [...methods, ...dependencies, methods[0]]);
  } catch (error) {
    if (/inventory contains a duplicate/.test(String(error))) return;
    throw error;
  }
  throw new Error('Duplicate configured-symbol fixture was not rejected');
}

function assertUniqueMutationOutputIds(ids) {
  const seen = new Set();
  for (const id of ids) {
    if (!/^mutation-\d{2}-[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Unsafe mutation output id: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate mutation output id: ${id}`);
    seen.add(id);
  }
}

function checkDuplicateMutationOutputFixture() {
  try {
    assertUniqueMutationOutputIds(['mutation-01-IsDocMarkerAt', 'mutation-01-IsDocMarkerAt']);
  } catch (error) {
    if (/Duplicate mutation output id/.test(String(error))) return;
    throw error;
  }
  throw new Error('Duplicate mutation output fixture was not rejected');
}

try {
  const configuredSymbols = validateGroupMembership(verificationGroups, [...methods, ...dependencies]);
  checkDuplicateGroupFixture();
  checkDuplicateInventoryFixture();
  checkDuplicateMutationOutputFixture();
  mkdirSync(output, { recursive: true });
  const version = run(['--version']).trim();
  if (!isPinnedDafnyVersion(version)) throw new Error(`Dafny 4.11.0 required; got ${version}`);
  const z3Version = run(['--version'], {}, z3).trim();
  if (!/^Z3 version 4\.16\.0\b/.test(z3Version)) throw new Error(`Z3 4.16.0 required; got ${z3Version}`);
  const z3Path = realpathSync(z3.includes('/') ? z3 : spawnSync('which', [z3], { encoding: 'utf8' }).stdout.trim());
  process.env.PATH = `${dirname(z3Path)}:${process.env.PATH ?? ''}`;
  const engineText = readFileSync(enginePath, 'utf8');
  if (/\b(?:assume|admit)\b|\{:axiom\b|\{:verify\s+false\b/.test(engineText)) {
    throw new Error('Engine.dfy contains an assume/admit/axiom/disabled-verification marker');
  }
  for (const name of [...methods, ...dependencies]) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = new RegExp(`\\b(?:method|lemma|function|ghost\\s+predicate)\\s+${escaped}\\b`);
    if (!declaration.test(engineText)) throw new Error(`Expected declaration not found: ${name}`);
  }
  requireContracts(engineText);
  const weakTrim = engineText.replace(
    'ensures TrimmedEnd(src, from as int, end as int, p as int)',
    'ensures WsRange(src, p as int, end as int)',
  );
  if (weakTrim === engineText) throw new Error('TrimmedEnd mutation setup did not change the contract');
  expectContractInventoryRejection(weakTrim, 'TrimTrailingWs: required contract missing', 'weak TrimTrailingWs contract');
  const noDocSourceLength = replaceExactlyOnceInMethod(
    engineText,
    'IsDocMarkerAt',
    'requires len as int == |src|',
    '// source-length condition removed',
  );
  expectContractInventoryRejection(noDocSourceLength, 'IsDocMarkerAt: required contract missing: requires len as int == |src|', 'missing document-marker source-length precondition');
  const weakDocBiconditional = replaceExactlyOnceInMethod(
    engineText,
    'IsDocMarkerAt',
    'ensures yes == DocumentMarkerAt(src, lineStart as int, i as int)',
    'ensures yes == (i == lineStart)',
  );
  expectContractInventoryRejection(weakDocBiconditional, 'IsDocMarkerAt: required contract missing', 'weakened document-marker biconditional');
  let alignedSpecAndBody = engineText.replace(
    'SpaceOrEolBoundaryAt(s, i + 3)',
    'true',
  );
  if (alignedSpecAndBody === engineText) throw new Error('aligned document-marker specification mutation target not found');
  alignedSpecAndBody = replaceExactlyOnceInMethod(alignedSpecAndBody, 'IsDocMarkerAt', 'yes := sep;', 'yes := true;');
  expectContractInventoryRejection(
    alignedSpecAndBody,
    'Scanner specification definition changed or weakened: ghost predicate DocumentMarkerAt',
    'aligned document-marker body/specification weakening',
  );

  const inputs = [
    join(root, 'src/dafny/core/Native.dfy'),
    join(root, 'src/dafny/core/TagValues.dfy'),
    enginePath,
    join(root, 'src/dafny/core/Serializer.dfy'),
  ];
  const selected = [];
  for (const [index, group] of verificationGroups.entries()) {
    const groupDir = join(output, `selection-${String(index + 1).padStart(2, '0')}`);
    mkdirSync(groupDir, { recursive: true });
    const logPath = join(groupDir, 'selected-symbols.csv');
    const consoleLog = run([
      '/unicodeChar:0',
      '/compileTarget:js',
      '/compile:0',
      '/timeLimit:60',
      `/proverOpt:PROVER_PATH=${z3Path}`,
      `/verificationLogger:csv;LogFileName=${logPath}`,
      `/proc:${group.pattern}`,
      ...inputs,
    ]);
    writeFileSync(join(groupDir, 'selected-symbols.stdout.txt'), consoleLog);
    selected.push(...recordSelection(logPath, consoleLog, group.names, group.pattern));
  }

  const mutationChecks = [];
  const mutations = [
    {
      symbol: 'ScanFlowPlainLine',
      label: 'removing the flow-delimiter stopping rule',
      from: 'if FlowIndicator(c) || c == 10 || c == 13 { break; }',
      to: 'if c == 10 || c == 13 { break; }',
    },
    {
      symbol: 'SkipInlineSpaces',
      label: 'removing cursor consumption',
      from: '        pos := pos + 1;',
      to: '        // deliberately removed cursor consumption',
    },
    {
      symbol: 'IsSpaceOrEolAt',
      label: 'removing tab separator recognition',
      from: 'yes := c == 32 || c == 9 || c == 10 || c == 13;',
      to: 'yes := c == 32 || c == 10 || c == 13;',
    },
    {
      symbol: 'IsSpaceOrEol',
      label: 'dropping carriage-return recognition',
      from: 'yes := c == 32 || c == 9 || c == 10 || c == 13;',
      to: 'yes := c == 32 || c == 9 || c == 10;',
    },
    {
      symbol: 'IsDocMarkerAt',
      label: 'dropping document-end dot recognition',
      from: 'if c != 45 && c != 46 { return; }',
      to: 'if c != 45 { return; }',
    },
    {
      symbol: 'IsDocMarkerAt',
      label: 'rejecting a marker at a nonzero stored lineStart',
      from: 'if i != lineStart || i + 2 >= len { return; }',
      to: 'if i != lineStart || i != 0 || i + 2 >= len { return; }',
    },
    {
      symbol: 'IsDocMarkerAt',
      label: 'removing the marker separator check',
      from: 'yes := sep;',
      to: 'yes := true;',
    },
    {
      symbol: 'LooksLikeDocMarkerAt',
      label: 'dropping document-end dot recognition at parser cursor',
      from: 'if c != 45 && c != 46 { return; }',
      to: 'if c != 45 { return; }',
    },
  ];
  const mutationOutputIds = mutations.map((mutation, index) => `mutation-${String(index + 1).padStart(2, '0')}-${mutation.symbol}`);
  assertUniqueMutationOutputIds(mutationOutputIds);
  for (const [index, mutation] of mutations.entries()) {
    const mutatedSource = replaceExactlyOnceInMethod(engineText, mutation.symbol, mutation.from, mutation.to);
    const mutationId = mutationOutputIds[index];
    const mutationDir = join(output, mutationId);
    mkdirSync(mutationDir, { recursive: true });
    const mutationSource = join(mutationDir, 'Engine.dfy');
    const mutationLog = join(mutationDir, 'verification.csv');
    writeFileSync(mutationSource, mutatedSource);
    const mutationInputs = inputs.map((file) => file === enginePath ? mutationSource : file);
    const mutationOutput = runExpectedVerificationFailure([
      '/unicodeChar:0',
      '/compileTarget:js',
      '/compile:0',
      '/timeLimit:60',
      `/proverOpt:PROVER_PATH=${z3Path}`,
      `/verificationLogger:csv;LogFileName=${mutationLog}`,
      `/proc:*${mutation.symbol}*`,
      ...mutationInputs,
    ]);
    writeFileSync(join(mutationDir, 'verifier.stdout.txt'), mutationOutput);
    const selectedSymbols = mutation.symbol === 'IsSpaceOrEol'
      ? ['IsSpaceOrEol', 'IsSpaceOrEolAt']
      : [mutation.symbol];
    const check = checkMutationLog(mutationLog, mutationOutput, mutation.symbol, selectedSymbols);
    mutationChecks.push({ mutationId, mutation: mutation.label, outcome: 'rejected as expected', ...check });
  }
  const sourceFiles = ['src/dafny/core/Native.dfy', 'src/dafny/core/TagValues.dfy', 'src/dafny/core/Serializer.dfy'];
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, sha256(readFileSync(join(root, file)))]));
  sourceHashes['src/dafny/core/Engine.dfy'] = sha256(readFileSync(enginePath));
  const generatedRuntime = readFileSync(join(root, 'src/dafny/generated/engine.js'));
  const runtimeHeader = generatedRuntime.toString('utf8').match(/^\/\/ Sources sha256 ([0-9a-f]{64});/m);
  const verifierPath = realpathSync(dafny.includes('/') ? dafny : spawnSync('which', [dafny], { encoding: 'utf8' }).stdout.trim());
  const report = {
    schemaVersion: 1,
    selectorMembership: { expectedSymbols: configuredSymbols.length, selectedExactlyOnce: true, duplicateGroupFixture: 'rejected', duplicateInventoryFixture: 'rejected' },
    mutationOutputIsolation: { caseCount: mutationChecks.length, uniqueCaseDirectories: true, duplicateOutputFixture: 'rejected' },
    compiler: {
      version,
      launcherExecutable: verifierPath,
      launcherExecutableSha256: sha256(readFileSync(verifierPath)),
      packageTrust: 'CI installs the official NuGet Dafny 4.11.0 package; the launcher hash is not a hash of the full .NET payload.',
    },
    solver: { version: z3Version, executable: z3Path, executableSha256: sha256(readFileSync(z3Path)), packageTrust: 'CI pins the official Z3 4.16.0 release archive by SHA-256.' },
    options: { command: 'legacy Dafny verifier', unicodeChar: false, compileTarget: 'js', compile: false, verificationTimeLimitSeconds: 60, solverOverride: `/proverOpt:PROVER_PATH=${z3Path}`, logFormat: 'csv', selectedProcedurePatterns: verificationGroups.map(({ pattern }) => pattern), noVerify: false },
    sources: sourceHashes,
    engineVerifierInput: enginePath,
    generatedRuntime: { path: 'src/dafny/generated/engine.js', sha256: sha256(generatedRuntime), sourceHeaderSha256: runtimeHeader?.[1] ?? null },
    verifierNativeSourceTransformation: 'none; original Native.dfy is verified directly under the JavaScript compilation target',
    verifiedMethods: selected.filter((entry) => methods.some((name) => entry.name.endsWith(`.${name}`))),
    specificationDependencies: selected.filter((entry) => dependencies.some((name) => entry.name.endsWith(`.${name}`))),
    mutationChecks: [
      { mutation: 'weakening TrimTrailingWs maximal-suffix contract', outcome: 'rejected by exact contract inventory' },
      ...mutationChecks,
    ],
    semanticCoverage: 'The eight executed scanner methods prove FlowSeparatorAt lexical first-boundary recognition, ScanFlowPlainLine lexical first-stop behavior, TrimTrailingWs maximal trailing-whitespace removal, SkipInlineSpaces exact consumed-prefix behavior, IsSpaceOrEolAt and IsSpaceOrEol exact horizontal-space-or-line-break recognition, and IsDocMarkerAt and LooksLikeDocMarkerAt exact three-character document-marker recognition with a required following boundary.',
    callerConditionsNotProved: ['len as int == |src| at entry', 'entry cursor/span bounds for each caller', 'for IsDocMarkerAt, the conditional arithmetic slack i != lineStart || i + 2 < 9007199254740000', 'that IsDocMarkerAt callers supply the actual beginning of a source line as lineStart'],
    frames: {
      FlowSeparatorAt: 'empty modifies frame (default)',
      ScanFlowPlainLine: 'empty modifies frame (default)',
      TrimTrailingWs: 'empty modifies frame (default)',
      SkipInlineSpaces: 'modifies this`pos only',
      IsSpaceOrEolAt: 'empty modifies frame (default)',
      IsDocMarkerAt: 'empty modifies frame (default)',
    },
    trustedOrUnverified: [
      'UTF-16 character semantics and Dafny translator/backend behavior.',
      'Native host functions are not in the selected dependency paths.',
      'No parser callers are proved to establish the selected preconditions.',
      'Other Engine, Native, Serializer, and pipeline methods remain unverified.',
      'This does not establish full YAML semantic equivalence or performance acceptance.',
    ],
  };
  writeFileSync(join(output, 'coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Verified ${methods.length} scanner methods and checked ${dependencies.length} specification dependencies.\nCoverage: ${join(output, 'coverage.json')}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
