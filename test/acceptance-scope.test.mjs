import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptanceScopeDetails,
  acceptanceStatus,
  classifyOverThreshold,
  parseAcceptanceScope,
} from '../bench/acceptance/scope.mjs';

test('cpu-memory scope keeps startup and bundle misses informational without dropping them', () => {
  const rows = [
    { metric: 'time', workload: 'parse-large' },
    { metric: 'cold-import', format: 'esm' },
    { metric: 'gzip-size', bundler: 'vite' },
  ];
  const classified = classifyOverThreshold(rows, 'cpu-memory');
  assert.deepEqual(classified.over15Percent, [rows[0]]);
  assert.deepEqual(classified.informationalOver15Percent, rows.slice(1));
  assert.deepEqual(classified.allOver15Percent, rows);
  assert.match(acceptanceStatus('cpu-memory', []), /cpu-memory scope only/);
  assert.doesNotMatch(acceptanceStatus('cpu-memory', []), /^pass$/);
  assert.equal(acceptanceScopeDetails('cpu-memory').collection, 'full; all measured suites and rows are retained');
});

test('default all scope retains startup and bundle as blockers', () => {
  const rows = [{ metric: 'cold-import' }, { metric: 'gzip-size' }];
  const classified = classifyOverThreshold(rows, parseAcceptanceScope());
  assert.deepEqual(classified.over15Percent, rows);
  assert.deepEqual(classified.informationalOver15Percent, []);
  assert.match(acceptanceStatus('all', rows), /^fail:/);
  assert.equal(acceptanceStatus('all', []), 'pass');
});

test('unknown acceptance scopes fail closed', () => {
  assert.throws(() => parseAcceptanceScope('speed-only'), /--acceptance must be one of/);
});

test('unclassified metrics fail closed instead of becoming informational', () => {
  assert.throws(() => classifyOverThreshold([{ metric: 'new-runtime-metric' }], 'cpu-memory'), /unclassified acceptance metric/);
});
