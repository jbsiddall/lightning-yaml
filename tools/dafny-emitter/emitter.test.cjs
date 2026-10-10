'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PIN, PINNED_PATCHES, PINNED_PATCH_SHA256, validateManifest, validateCheckoutFacts, requiredPath, buildProvenance,
  currentDiffSha256, digestFile, verifySetupState, verifyBuiltArtifacts } = require('./emitter.cjs');

function manifest(patches = []) {
  return {
    repository: 'https://github.com/dafny-lang/dafny.git',
    tag: 'v4.11.0',
    commit: PIN,
    driverProject: 'Source/Dafny/Dafny.csproj',
    stockTarget: 'js',
    candidateTarget: 'js-native',
    candidateArguments: [],
    patchSha256: PINNED_PATCH_SHA256,
    patches,
  };
}

test('manifest accepts only the pinned upstream and fixed target profiles', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dafny-emitter-pin-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'patches'));
  fs.writeFileSync(path.join(directory, PINNED_PATCHES[0]),
    fs.readFileSync(path.join(__dirname, PINNED_PATCHES[0])));
  assert.equal(validateManifest(manifest(PINNED_PATCHES), directory).commit, PIN);
  assert.throws(() => validateManifest({ ...manifest(), commit: '0'.repeat(40) }), /source pin/);
  assert.throws(() => validateManifest({ ...manifest(PINNED_PATCHES), candidateTarget: 'js' }, directory), /CLI profile/);
});

test('patch manifest is ordered, confined, and references existing patch files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dafny-emitter-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'patches'));
  fs.writeFileSync(path.join(directory, PINNED_PATCHES[0]),
    fs.readFileSync(path.join(__dirname, PINNED_PATCHES[0])));
  assert.deepEqual(validateManifest(manifest(PINNED_PATCHES), directory).patches, PINNED_PATCHES);
  assert.throws(() => validateManifest(manifest(['../outside.patch']), directory), /unexpected pinned Dafny patch series/);
  assert.throws(() => validateManifest(manifest(), directory), /unexpected pinned Dafny patch series/);
  fs.rmSync(path.join(directory, PINNED_PATCHES[0]));
  assert.throws(() => validateManifest(manifest(PINNED_PATCHES), directory), /missing or unsafe patch/);
});

test('checkout checks reject source drift and cache paths must be explicit absolute paths', () => {
  assert.doesNotThrow(() => validateCheckoutFacts(PIN, ''));
  assert.throws(() => validateCheckoutFacts('0'.repeat(40), ''), /revision mismatch/);
  assert.throws(() => validateCheckoutFacts(PIN, ' M Source/file.cs'), /dirty/);
  assert.equal(requiredPath('/tmp/cache', 'cache'), '/tmp/cache');
  assert.throws(() => requiredPath('cache', 'cache'), /absolute path/);
});

test('provenance carries the source pin, selected target, ordered patch hashes, and runtime hash', () => {
  const selected = manifest(['patches/0001-first.patch']);
  const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
  const result = buildProvenance({
    manifest: selected,
    profile: 'candidate',
    worktree: '/tmp/cache/candidate',
    patchHashes: [{ path: selected.patches[0], sha256: sha256('patch bytes') }],
    runtimeJar: { path: '/tmp/DafnyRuntime.jar', sha256: sha256('jar bytes') },
    diffSha256: sha256('tree diff'),
  });
  assert.equal(result.commit, PIN);
  assert.equal(result.target, 'js-native');
  assert.equal(result.patches[0].sha256, sha256('patch bytes'));
  assert.equal(result.runtimeJar.sha256, sha256('jar bytes'));
  assert.equal(result.worktreeDiffSha256, sha256('tree diff'));
});

test('git cache provenance rejects unstaged files, source drift, and changed patch bytes', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dafny-emitter-git-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const cache = path.join(temporary, 'cache');
  const candidate = path.join(cache, 'candidate');
  const toolDir = path.join(temporary, 'tool');
  const toolPatches = path.join(toolDir, 'patches');
  const patchPath = path.join(toolPatches, PINNED_PATCHES[0].slice('patches/'.length));
  fs.mkdirSync(candidate, { recursive: true });
  fs.mkdirSync(toolPatches, { recursive: true });
  fs.writeFileSync(patchPath, 'first patch bytes');
  t.after(() => fs.rmSync(patchPath, { force: true }));

  const git = (args, options = {}) => {
    const result = spawnSync('git', args, { cwd: candidate, encoding: 'utf8', ...options });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  git(['config', 'user.name', 'Emitter tooling test']);
  git(['config', 'user.email', 'emitter-test@example.invalid']);
  fs.writeFileSync(path.join(candidate, 'tracked.txt'), 'base');
  git(['add', 'tracked.txt']);
  git(['commit', '-qm', 'baseline']);
  const commit = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(candidate, 'new-source.cs'), 'candidate patch');
  git(['add', 'new-source.cs']);

  const selected = manifest(PINNED_PATCHES);
  const stamp = buildProvenance({
    manifest: selected,
    profile: 'candidate',
    worktree: candidate,
    patchHashes: [{ path: selected.patches[0], sha256: digestFile(patchPath) }],
    runtimeJar: null,
    diffSha256: currentDiffSha256(candidate),
  });
  stamp.commit = commit;
  fs.writeFileSync(path.join(cache, 'candidate.provenance.json'), JSON.stringify(stamp));
  assert.doesNotThrow(() => verifySetupState(cache, selected, 'candidate', commit, toolDir));

  fs.writeFileSync(path.join(candidate, 'untracked.tmp'), 'drift');
  assert.throws(() => verifySetupState(cache, selected, 'candidate', commit, toolDir), /untracked/);
  fs.rmSync(path.join(candidate, 'untracked.tmp'));
  fs.writeFileSync(path.join(candidate, 'tracked.txt'), 'changed source');
  assert.throws(() => verifySetupState(cache, selected, 'candidate', commit, toolDir), /differs from its setup patch state/);
  fs.writeFileSync(path.join(candidate, 'tracked.txt'), 'base');
  fs.writeFileSync(patchPath, 'changed patch bytes');
  assert.throws(() => verifySetupState(cache, selected, 'candidate', commit, toolDir), /patch series changed/);
});

test('built compiler and runtime jar hashes reject stale cache artifacts', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dafny-emitter-artifacts-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const core = path.join(temporary, 'DafnyCore.dll');
  const runtime = path.join(temporary, 'DafnyRuntime-4.11.0.jar');
  fs.writeFileSync(core, 'built core');
  fs.writeFileSync(runtime, 'runtime jar');
  const stamp = { builtArtifacts: [{ path: core, sha256: digestFile(core) }],
    runtimeJar: { cachePath: runtime, sha256: digestFile(runtime) } };
  assert.doesNotThrow(() => verifyBuiltArtifacts(stamp));
  fs.writeFileSync(core, 'stale core');
  assert.throws(() => verifyBuiltArtifacts(stamp), /built artifact changed/);
  fs.writeFileSync(core, 'built core');
  fs.writeFileSync(runtime, 'changed runtime');
  assert.throws(() => verifyBuiltArtifacts(stamp), /runtime jar changed/);
});
