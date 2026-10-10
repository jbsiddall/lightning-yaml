#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOL_DIR = __dirname;
const REPO_ROOT = path.resolve(TOOL_DIR, '../..');
const MANIFEST_PATH = path.join(TOOL_DIR, 'upstream.json');
const PIN = 'fcb2042d6d043a2634f0854338c08feeaaaf4ae2';
const PINNED_PATCHES = ['patches/0001-js-native-array-push.patch'];
const PINNED_PATCH_SHA256 = '48aa47d0918d0fb37b3557528b77b951f781debbab79ee7f1d86956507e02d33';

function validateManifest(manifest, toolDir = TOOL_DIR) {
  if (manifest.repository !== 'https://github.com/dafny-lang/dafny.git' ||
      manifest.commit !== PIN || manifest.tag !== 'v4.11.0' ||
      manifest.driverProject !== 'Source/Dafny/Dafny.csproj') throw new Error('unexpected Dafny source pin');
  if (JSON.stringify(manifest.patches) !== JSON.stringify(PINNED_PATCHES)) {
    throw new Error('unexpected pinned Dafny patch series');
  }
  if (manifest.patchSha256 !== PINNED_PATCH_SHA256) throw new Error('unexpected pinned Dafny patch hash');
  if (manifest.stockTarget !== 'js' || manifest.candidateTarget !== 'js-native' ||
      JSON.stringify(manifest.candidateArguments) !== JSON.stringify([])) {
    throw new Error('unexpected stock or candidate CLI profile');
  }
  for (const patch of manifest.patches) {
    if (!/^patches\/[0-9]{4}-[a-z0-9-]+\.patch$/.test(patch)) throw new Error(`invalid pinned patch path: ${patch}`);
    const absolute = path.resolve(toolDir, patch);
    if (!absolute.startsWith(`${path.resolve(toolDir)}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`missing or unsafe patch: ${patch}`);
    }
    if (digestFile(absolute) !== PINNED_PATCH_SHA256) throw new Error(`pinned patch content changed: ${patch}`);
  }
  return manifest;
}

function loadManifest() {
  return validateManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')));
}

function digestFile(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw result.error || new Error(`${command} exited with status ${result.status}`);
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw result.error || new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function checkPinnedCleanSource(source) {
  const commit = capture('git', ['rev-parse', 'HEAD'], source);
  const dirty = capture('git', ['status', '--porcelain'], source);
  validateCheckoutFacts(commit, dirty);
}

function validateCheckoutFacts(commit, dirty) {
  if (commit !== PIN) throw new Error(`source revision mismatch: expected ${PIN}, got ${commit}`);
  if (dirty) throw new Error(`source checkout is dirty:\n${dirty}`);
}

function options(args) {
  const result = { rest: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') { result.rest = args.slice(index + 1); break; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (Object.hasOwn(result, key)) throw new Error(`duplicate option: ${arg}`);
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`expected a value after ${arg}`);
      result[key] = value;
      index += 1;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return result;
}

function requiredPath(value, name) {
  if (!value || !path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path`);
  return path.resolve(value);
}

function profileRoot(cache, profile) {
  if (profile !== 'stock' && profile !== 'candidate') throw new Error('--profile must be stock or candidate');
  return path.join(cache, profile);
}

function buildProvenance({ manifest, profile, worktree, patchHashes, runtimeJar, diffSha256 }) {
  return {
    upstream: manifest.repository,
    tag: manifest.tag,
    commit: PIN,
    profile,
    target: profile === 'stock' ? manifest.stockTarget : manifest.candidateTarget,
    patches: profile === 'candidate' ? patchHashes : [],
    runtimeJar,
    worktree,
    worktreeDiffSha256: diffSha256,
  };
}

function currentDiffSha256(worktree) {
  return crypto.createHash('sha256').update(capture('git', ['diff', '--binary', 'HEAD'], worktree)).digest('hex');
}

function writeProvenance(cache, manifest, profile, runtimeJar) {
  const root = profileRoot(cache, profile);
  const initial = verifySetupState(cache, manifest, profile);
  const diffSha256 = currentDiffSha256(root);
  if (initial.worktreeDiffSha256 !== diffSha256) throw new Error(`worktree source changed while building: ${root}`);
  const patchHashes = initial.patches;
  const runtime = initial.runtimeJar;
  const provenance = buildProvenance({ manifest, profile, worktree: root, patchHashes, runtimeJar: runtime, diffSha256 });
  return provenance;
}

function initialProvenance(cache, manifest, profile, worktree, runtimeJar) {
  const patchHashes = manifest.patches.map(relative => ({ path: relative, sha256: digestFile(path.join(TOOL_DIR, relative)) }));
  return buildProvenance({
    manifest, profile, worktree, patchHashes,
    runtimeJar: runtimeJar || null,
    diffSha256: currentDiffSha256(worktree),
  });
}

function verifySetupState(cache, manifest, profile, expectedCommit = PIN, toolDir = TOOL_DIR) {
  const root = profileRoot(cache, profile);
  const stampPath = path.join(cache, `${profile}.provenance.json`);
  if (!fs.existsSync(stampPath)) throw new Error(`run setup first; missing ${stampPath}`);
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  const commit = capture('git', ['rev-parse', 'HEAD'], root);
  if (commit !== expectedCommit || stamp.commit !== expectedCommit) throw new Error(`worktree revision mismatch: expected ${expectedCommit}, got ${commit}`);
  const status = capture('git', ['status', '--porcelain'], root);
  if (status.split('\n').some(line => line.startsWith('??'))) throw new Error(`unexpected untracked source files:\n${status}`);
  const diffSha256 = currentDiffSha256(root);
  if (stamp.worktreeDiffSha256 !== diffSha256) throw new Error(`worktree source differs from its setup patch state: ${root}`);
  const patchHashes = manifest.patches.map(relative => ({ path: relative, sha256: digestFile(path.join(toolDir, relative)) }));
  if (JSON.stringify(stamp.patches) !== JSON.stringify(profile === 'candidate' ? patchHashes : [])) {
    throw new Error(`patch series changed since setup for ${profile}`);
  }
  return stamp;
}

function verifyBuiltArtifacts(stamp) {
  if (!stamp.builtArtifacts?.length) throw new Error('no build artifacts in provenance');
  for (const artifact of stamp.builtArtifacts) {
    if (!fs.existsSync(artifact.path) || digestFile(artifact.path) !== artifact.sha256) {
      throw new Error(`built artifact changed since the recorded build: ${artifact.path}`);
    }
  }
  if (stamp.runtimeJar?.cachePath &&
      (!fs.existsSync(stamp.runtimeJar.cachePath) || digestFile(stamp.runtimeJar.cachePath) !== stamp.runtimeJar.sha256)) {
    throw new Error(`runtime jar changed since setup: ${stamp.runtimeJar.cachePath}`);
  }
}

function dotnetEnvironment(dotnet) {
  const directory = path.dirname(path.resolve(dotnet));
  return { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH || ''}` };
}

function installRuntimeJar(worktree, runtimeJar) {
  if (!runtimeJar) return null;
  const source = path.resolve(runtimeJar);
  if (!fs.statSync(source).isFile()) throw new Error(`runtime jar not found: ${source}`);
  const target = path.join(worktree, 'Source/DafnyRuntime/DafnyRuntimeJava/build/libs/DafnyRuntime-4.11.0.jar');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return { path: source, cachePath: target, sha256: digestFile(source) };
}

function setup(cache, runtimeJar) {
  const manifest = loadManifest();
  fs.mkdirSync(cache, { recursive: true });
  const entries = fs.readdirSync(cache);
  if (entries.length) throw new Error(`cache directory must be empty: ${cache}`);
  const source = path.join(cache, 'upstream');
  run('git', ['clone', '--depth', '1', '--branch', manifest.tag, '--single-branch', manifest.repository, source]);
  checkPinnedCleanSource(source);
  for (const profile of ['stock', 'candidate']) {
    const worktree = profileRoot(cache, profile);
    run('git', ['worktree', 'add', '--detach', worktree, PIN], { cwd: source });
    if (profile === 'candidate') {
      for (const patch of manifest.patches) {
        const patchPath = path.join(TOOL_DIR, patch);
        run('git', ['apply', '--check', patchPath], { cwd: worktree });
        run('git', ['apply', '--index', patchPath], { cwd: worktree });
      }
    }
    const runtime = installRuntimeJar(worktree, runtimeJar);
    fs.writeFileSync(path.join(cache, `${profile}.provenance.json`), `${JSON.stringify(
      initialProvenance(cache, manifest, profile, worktree, runtime), null, 2)}\n`);
  }
}

function build(cache, profile, runtimeJar) {
  const manifest = loadManifest();
  const worktree = profileRoot(cache, profile);
  if (!fs.existsSync(worktree)) throw new Error(`run setup first; missing ${worktree}`);
  const initial = verifySetupState(cache, manifest, profile);
  let runtime = initial.runtimeJar;
  if (runtimeJar) {
    const requested = { path: path.resolve(runtimeJar), cachePath: runtime?.cachePath, sha256: digestFile(runtimeJar) };
    if (runtime && requested.sha256 !== runtime.sha256) throw new Error('runtime jar differs from the setup provenance');
    runtime = installRuntimeJar(worktree, runtimeJar);
  }
  const dotnet = process.env.DOTNET || 'dotnet';
  const project = path.join(worktree, manifest.driverProject);
  run(dotnet, ['build', project, '--configuration', 'Release'], { cwd: worktree, env: dotnetEnvironment(dotnet) });
  const output = path.join(worktree, 'Binaries/net8.0/Dafny.dll');
  if (!fs.existsSync(output)) throw new Error(`built driver not found: ${output}`);
  const stamp = {
    ...writeProvenance(cache, manifest, profile, runtimeJar),
    runtimeJar: runtime,
    builtDriver: output,
    builtArtifacts: ['Dafny.dll', 'DafnyCore.dll'].map(name => {
      const filename = path.join(path.dirname(output), name);
      if (!fs.existsSync(filename)) throw new Error(`built artifact not found: ${filename}`);
      return { path: filename, sha256: digestFile(filename) };
    }),
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(cache, `${profile}.provenance.json`), `${JSON.stringify(stamp, null, 2)}\n`);
}

function translate(cache, profile, args) {
  const manifest = loadManifest();
  const worktree = profileRoot(cache, profile);
  const stamp = verifySetupState(cache, manifest, profile);
  try { verifyBuiltArtifacts(stamp); } catch (error) { throw new Error(`build ${profile} first or restore its recorded artifacts: ${error.message}`); }
  const driver = path.join(worktree, 'Binaries/net8.0/Dafny.dll');
  if (!fs.existsSync(driver)) throw new Error(`build ${profile} first; missing ${driver}`);
  if (!args.length) throw new Error('pass compiler arguments after --');
  const dotnet = process.env.DOTNET || 'dotnet';
  run(dotnet, [driver, 'translate', profile === 'stock' ? manifest.stockTarget : manifest.candidateTarget,
    ...(profile === 'candidate' ? manifest.candidateArguments : []), ...args]);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const parsed = options(args);
  if (command === 'setup') {
    setup(requiredPath(parsed.cache, 'cache'), parsed['runtime-jar']);
  } else if (command === 'build') {
    build(requiredPath(parsed.cache, 'cache'), parsed.profile, parsed['runtime-jar']);
  } else if (command === 'translate') {
    translate(requiredPath(parsed.cache, 'cache'), parsed.profile, parsed.rest);
  } else if (command === 'provenance') {
    const manifest = loadManifest();
    const cache = requiredPath(parsed.cache, 'cache');
    for (const profile of ['stock', 'candidate']) {
      const stamp = verifySetupState(cache, manifest, profile);
      process.stdout.write(`${JSON.stringify(stamp, null, 2)}\n`);
    }
    process.stdout.write(`patch files: ${JSON.stringify(manifest.patches)}\n`);
  } else {
    throw new Error('usage: emitter.cjs setup|build|translate|provenance [options]');
  }
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { PIN, PINNED_PATCHES, PINNED_PATCH_SHA256, loadManifest, validateManifest, digestFile, buildProvenance, currentDiffSha256,
  checkPinnedCleanSource, validateCheckoutFacts, verifySetupState, verifyBuiltArtifacts, dotnetEnvironment, requiredPath, profileRoot };
