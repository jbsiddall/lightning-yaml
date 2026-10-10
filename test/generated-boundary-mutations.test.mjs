import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cases = [
  ['LY_INJECT_BAD_ESCAPER', 'test/dafny-quotes.generated.mjs'],
  ['LY_INJECT_BAD_FOLD', 'test/dafny-quotes.generated.mjs'],
  ['LY_INJECT_BAD_CHOMP', 'test/dafny-block-scalars.generated.mjs'],
];

for (const [variable, relativeFile] of cases) {
  test(`generated diagnostics detect ${variable}`, () => {
    const file = fileURLToPath(new URL(`../${relativeFile}`, import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', file], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, [variable]: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'injected host regression unexpectedly passed');
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/);
  });
}
