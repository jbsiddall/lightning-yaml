'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { audit } = require('./check-output.cjs');

if (process.env.DAFNY_EXPERIMENT_SANDBOX !== '1') throw new Error('Use run.sh to enter the sandbox');
const compiler = process.argv[2] || 'dafny';
const repo = path.resolve(__dirname, '../../..');
const tsc = path.join(repo, 'node_modules/typescript/bin/tsc');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: __dirname, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

run(compiler, ['build', '--target', 'js', '--unicode-char', 'false',
  '--allow-external-contracts', '--spill-translation', '--output', 'generated.js', 'NativeValues.dfy']);
run(process.execPath, [tsc, '-p', 'tsconfig.json']);
run(process.execPath, [tsc, '-p', 'tsconfig.consumer.json']);

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'guard.json'), 'utf8'));
const checked = audit(config, __dirname);
if (!checked.ok) throw new Error(checked.diagnostics.join('\n'));
console.log(JSON.stringify({ outputGuard: 'passed', checkedFiles: checked.checkedFiles,
  roots: config.generated.flatMap(file => file.roots) }));

run(process.execPath, ['--test', 'checker.test.cjs']);
run(process.execPath, ['runtime.test.cjs']);
run(process.execPath, ['api.test.cjs']);
run(process.execPath, ['integration.test.cjs']);

const { loadNativeApi } = require('./load.cjs');
const api = loadNativeApi();
const example = api.demo();
assert.equal(example.self, example);
console.log(JSON.stringify({ nativeValuePath: 'passed', wrapperAllocations: 'none observed in values',
  output: 'plain cyclic object, shared child, native dense arrays and primitives',
  sourceProof: 'conditional on trusted JS extern contracts',
  outputGuard: 'syntactic regression guard; not a performance proof' }));
