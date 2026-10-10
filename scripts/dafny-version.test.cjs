'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPinnedDafnyVersion } = require('./dafny-version.cjs');

test('accepts the pinned Dafny release with or without official NuGet build metadata', () => {
  assert.equal(isPinnedDafnyVersion('4.11.0'), true);
  assert.equal(isPinnedDafnyVersion('4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2'), true);
  assert.equal(isPinnedDafnyVersion(' 4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2\n'), true);
});

test('rejects other releases, prereleases, and version-looking suffixes', () => {
  for (const version of [
    '4.11.1',
    '4.12.0',
    '4.110.0',
    '4.11.0-rc.1',
    '4.11.0+rc.1',
    '4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2-extra',
    'v4.11.0',
    'Dafny 4.11.0+fcb2042d6d043a2634f0854338c08feeaaaf4ae2',
  ]) {
    assert.equal(isPinnedDafnyVersion(version), false, version);
  }
});
