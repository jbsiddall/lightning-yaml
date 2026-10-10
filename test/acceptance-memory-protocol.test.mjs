import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const memorySample = resolve(repoRoot, 'bench/acceptance/memory-sample.mjs');
const datasetNames = [
  'large-nested', 'large-records', 'medium-nested', 'medium-records',
  'small-records', 'xlarge-records', 'yaml-plain-large-records',
  'yaml-plain-medium-nested', 'yaml-plain-medium-records',
  'yaml-plain-small-records', 'yaml-rich-large', 'yaml-rich-medium', 'yaml-rich-small',
];

test('memory companion keeps stdout to one complete JSON document', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lightning-yaml-memory-protocol-'));
  try {
    mkdirSync(join(root, 'bench/memory'), { recursive: true });
    mkdirSync(join(root, 'bench/fixtures'), { recursive: true });
    writeFileSync(join(root, 'bench/fixtures/datasets.ts'), `export const datasets = ${JSON.stringify(datasetNames.map((name) => ({ name })))};\n`);
    writeFileSync(join(root, 'bench/memory/run.ts'), `
const datasetNames = ${JSON.stringify(datasetNames)};
export function runMemoryMatrix() {
  return datasetNames.flatMap((dataset) => ['parse', 'stringify'].map((op) => ({
    candidate: 'lightning-yaml', dataset, op, iters: 25, peakRssBytes: 8192, heapDeltaBytes: 128,
  })));
}
export function emitMemoryYaml() { console.log('Wrote fake memory report'); }
`);

    const previousArgv = process.argv;
    const previousIterations = process.env.BENCH_ITERS;
    const previousScope = process.env.BENCH_SCOPE;
    const previousLog = console.log;
    const previousError = console.error;
    const stdout = [];
    const stderr = [];
    process.argv = [process.execPath, memorySample, root];
    process.env.BENCH_ITERS = '25';
    console.log = (...args) => stdout.push(args.join(' '));
    console.error = (...args) => stderr.push(args.join(' '));
    try {
      const testUrl = new URL(pathToFileURL(memorySample));
      testUrl.searchParams.set('run', `${Date.now()}-${Math.random()}`);
      await import(testUrl.href);
    } finally {
      process.argv = previousArgv;
      if (previousIterations === undefined) delete process.env.BENCH_ITERS;
      else process.env.BENCH_ITERS = previousIterations;
      if (previousScope === undefined) delete process.env.BENCH_SCOPE;
      else process.env.BENCH_SCOPE = previousScope;
      console.log = previousLog;
      console.error = previousError;
    }

    const stdoutText = stdout.join('\n').trim();
    assert.doesNotMatch(stdoutText, /Wrote fake memory report/);
    const payload = JSON.parse(stdoutText);
    assert.equal(payload.iterations, 25);
    for (const op of ['parse', 'stringify']) {
      assert.deepEqual(
        payload.results.filter((row) => row.candidate === 'lightning-yaml' && row.op === op).map((row) => row.dataset),
        datasetNames,
      );
    }
    assert.equal(payload.results.length, datasetNames.length * 2);
    assert.match(stderr.join('\n'), /Wrote fake memory report/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
