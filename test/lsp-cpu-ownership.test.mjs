import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditOwnedCpuProfile, validateOwnershipManifest } from '../scripts/compatibility/lsp-cpu-ownership.mjs'
import { sha256 } from '../scripts/compatibility/lsp-cpu-audit.mjs'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lsp-ownership-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'source.mjs'), source = 'function batch() {}\nfunction operation() {}\nfunction resolve() {}\n'
  writeFileSync(path, source)
  const frame = (functionName, lineNumber) => ({ functionName, lineNumber, columnNumber: 0, url: pathToFileURL(path).href, scriptId: '1' })
  const owned = (functionName, lineNumber) => ({ moduleId: 'fixture:source.mjs', functionName, lineNumber, columnNumber: 0 })
  const manifest = {
    schema: 'lsp-exact-source-ownership-v1', modules: [{ id: 'fixture:source.mjs', path, sha256: sha256(source) }],
    functions: [{ ...owned('resolve', 2), category: 'customTagCallback' }],
    boundaries: { operation: owned('operation', 1), batch: owned('batch', 0) },
  }
  const nodes = [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: [2, 6] },
    { id: 2, callFrame: frame('batch', 0), children: [3] },
    { id: 3, callFrame: frame('operation', 1), children: [4, 5, 7] },
    { id: 4, callFrame: frame('resolve', 2) },
    { id: 5, callFrame: { ...frame('resolve', 2), columnNumber: 1 } },
    { id: 6, callFrame: { functionName: '(garbage collector)', url: '', lineNumber: -1, columnNumber: -1 } },
    { id: 7, callFrame: { ...frame('resolve', 2), url: 'file:///another/source.mjs' } },
  ]
  const profile = { nodes, samples: [4, 4, 4, 5, 6, 7], timeDeltas: [20, 10, 10, 10, 10, 10], startTime: 100, endTime: 180 }
  const audit = (p = profile, m = manifest) => { const bytes = Buffer.from(JSON.stringify(p)); return auditOwnedCpuProfile(bytes, sha256(bytes), m) }
  return { dir, path, source, manifest, profile, audit }
}

test('exact operation leaf coverage keeps framing, runtime and unknown visible', (t) => {
  const { audit } = fixture(t), result = audit()
  assert.equal(result.sampleCount, 6)
  assert.equal(result.operationSamples, 4)
  assert.equal(result.usefulSamples, 2)
  assert.deepEqual(result.coverage, { numerator: 2, denominator: 5, ratio: 0.4 })
  assert.equal(result.adequate, false)
  assert.equal(result.exclusive.framing.samples, 1)
  assert.equal(result.exclusive.customTagCallback.samples, 2)
  assert.equal(result.exclusive.unknown.samples, 2)
  assert.equal(result.exclusive.runtime.samples, 1)
  assert.equal(Object.values(result.exclusive).reduce((sum, row) => sum + row.samples, 0), 6)
  assert.equal(result.clock.spanUs, 80)
  assert.equal(result.clock.deltaSumUs, 70)
  assert.equal(result.clock.trailingUnassignedUs, 10)
})

test('strict function name, location and module path prevent basename or resolve-name matches', (t) => {
  const { profile, audit } = fixture(t)
  profile.nodes.find((node) => node.id === 4).callFrame.functionName = 'anotherResolve'
  assert.equal(audit().coverage.numerator, 0)
  assert.equal(audit().exclusive.unknown.samples, 4)
})

test('inclusive and nearest-owned ancestry cannot turn unknown child leaves into coverage', (t) => {
  const { manifest, profile, audit } = fixture(t)
  manifest.functions.push({ ...manifest.boundaries.operation, category: 'serverWrapper' })
  profile.nodes.find((node) => node.id === 4).children = [8]
  profile.nodes.push({ id: 8, callFrame: { functionName: 'unknown', url: 'file:///unknown.js', lineNumber: 0, columnNumber: 0 } })
  profile.samples = [4, 8, 8]
  profile.timeDeltas = [10, 10, 10]
  const result = audit()
  assert.deepEqual(result.coverage, { numerator: 0, denominator: 2, ratio: 0 })
  assert.equal(result.nearestOwned.customTagCallback.samples, 2)
  assert.equal(result.inclusive.customTagCallback.samples, 2)
  assert.equal(result.inclusive.serverWrapper.samples, 2)
})

test('module mutation and duplicate definitions fail before attribution', (t) => {
  const { path, manifest, audit } = fixture(t)
  assert.equal(validateOwnershipManifest(manifest), manifest)
  manifest.functions.push({ ...manifest.functions[0] })
  assert.throws(audit, /duplicate ownership definition/)
  manifest.functions.pop()
  writeFileSync(path, 'changed source')
  assert.throws(audit, /module SHA256 mismatch/)
})

test('profile digest, cycles and operation without batch ancestry fail closed', (t) => {
  const { manifest, profile, audit } = fixture(t)
  const bytes = Buffer.from(JSON.stringify(profile))
  assert.throws(() => auditOwnedCpuProfile(bytes, '0'.repeat(64), manifest), /SHA256 mismatch/)
  profile.nodes.find((node) => node.id === 4).children = [2]
  assert.throws(audit, /multiple parents|cycle/)
  delete profile.nodes.find((node) => node.id === 4).children
  profile.nodes.find((node) => node.id === 2).callFrame.functionName = 'notBatch'
  assert.throws(audit, /lacks batch ancestry/)
})

test('200 exact operation leaf samples and 80 percent full post-framing coverage are both required', (t) => {
  const { profile, audit } = fixture(t)
  profile.samples = [4, ...Array(200).fill(4), ...Array(50).fill(6)]
  profile.timeDeltas = profile.samples.map(() => 1)
  profile.endTime = profile.startTime + profile.samples.length
  assert.equal(audit().adequate, true)
  profile.samples.push(6); profile.timeDeltas.push(1); profile.endTime++
  assert.equal(audit().adequate, false)
  profile.samples = [4, ...Array(199).fill(4)]; profile.timeDeltas = profile.samples.map(() => 1)
  assert.equal(audit().adequate, false)
})
