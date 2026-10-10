'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { proverPathArgument, resolveZ3Path } = require('./dafny-solver.cjs');

test('resolves Z3 to an absolute PATH executable when DAFNY_Z3 is unset', () => {
  const root = mkdtempSync(join(tmpdir(), 'dafny-z3-path-'));
  const bin = join(root, 'z3-bin');
  const executable = join(bin, 'z3');
  mkdirSync(bin);
  writeFileSync(executable, '#!/bin/sh\nprintf "Z3 version 4.16.0 test\\n"\n');
  chmodSync(executable, 0o755);

  try {
    const resolved = resolveZ3Path('', bin);
    assert.equal(resolved, executable);
    assert.equal(proverPathArgument(resolved), `/proverOpt:PROVER_PATH=${executable}`);
    const version = spawnSync(resolved, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0);
    assert.match(version.stdout, /^Z3 version 4\.16\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit DAFNY_Z3 path takes precedence over PATH lookup', () => {
  const root = mkdtempSync(join(tmpdir(), 'dafny-z3-override-'));
  const first = join(root, 'first');
  const second = join(root, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const pathTool = join(first, 'z3');
  const overrideTool = join(second, 'solver');
  for (const executable of [pathTool, overrideTool]) {
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
  }
  try {
    assert.equal(resolveZ3Path(overrideTool, first), overrideTool);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
