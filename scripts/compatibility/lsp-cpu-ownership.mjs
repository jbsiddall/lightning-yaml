import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { auditCpuProfile, readHashBoundJson, sha256 } from './lsp-cpu-audit.mjs'

const tuple = (frame) => JSON.stringify([frame.moduleId, frame.functionName, frame.lineNumber, frame.columnNumber])
const reserved = new Set(['unknown', 'runtime', 'harness', 'boundary', 'framing'])

export function validateOwnershipManifest(manifest) {
  if (manifest?.schema !== 'lsp-exact-source-ownership-v1' || !Array.isArray(manifest.modules)
    || !Array.isArray(manifest.functions)) throw new Error('invalid ownership manifest')
  const ids = new Set(), paths = new Set(), definitions = new Set()
  for (const mod of manifest.modules) {
    if (!mod || typeof mod.id !== 'string' || !mod.id || ids.has(mod.id)
      || typeof mod.path !== 'string' || !isAbsolute(mod.path)
      || !/^[a-f0-9]{64}$/.test(mod.sha256)) throw new Error('invalid ownership module')
    const physical = realpathSync(mod.path)
    if (paths.has(physical)) throw new Error('duplicate physical ownership module')
    if (sha256(readFileSync(physical)) !== mod.sha256) throw new Error('ownership module SHA256 mismatch')
    ids.add(mod.id); paths.add(physical)
  }
  function check(frame) {
    if (!frame || !ids.has(frame.moduleId) || typeof frame.functionName !== 'string'
      || !Number.isInteger(frame.lineNumber) || frame.lineNumber < 0
      || !Number.isInteger(frame.columnNumber) || frame.columnNumber < 0) throw new Error('invalid ownership function')
  }
  for (const frame of manifest.functions) {
    check(frame)
    if (typeof frame.category !== 'string' || !frame.category || (reserved.has(frame.category) && frame.category !== 'harness')
      || definitions.has(tuple(frame))) throw new Error('invalid/duplicate ownership definition')
    definitions.add(tuple(frame))
  }
  check(manifest.boundaries?.operation); check(manifest.boundaries?.batch)
  if (tuple(manifest.boundaries.operation) === tuple(manifest.boundaries.batch)) throw new Error('duplicate boundaries')
  return manifest
}

// Unknown source leaves cannot inherit ownership merely because parse() appears above them.
// Native and detached GC frames stay separate even when an operation is on their ancestry.
export function auditOwnedCpuProfile(bytes, expectedSha256, manifest) {
  validateOwnershipManifest(manifest)
  const validated = auditCpuProfile(bytes, expectedSha256)
  const profile = readHashBoundJson(bytes, expectedSha256)
  const modulesByUrl = new Map()
  for (const mod of manifest.modules) {
    modulesByUrl.set(pathToFileURL(mod.path).href, mod.id)
    modulesByUrl.set(pathToFileURL(realpathSync(mod.path)).href, mod.id)
  }
  const definitions = new Map(manifest.functions.map((def) => [tuple(def), def.category]))
  function identity(frame) {
    let url = frame.url
    // URL query/hash/script suffixes are different source identities, not normalization hints.
    if (url.startsWith('file:')) {
      try { if (new URL(url).href !== url) return null; fileURLToPath(url) } catch { return null }
    }
    const moduleId = modulesByUrl.get(url)
    return moduleId ? { ...frame, moduleId } : null
  }
  const same = (frame, boundary) => {
    const actual = identity(frame)
    return actual !== null && tuple(actual) === tuple(boundary)
  }
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map()
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id)
  const stackFor = (id) => {
    const stack = []
    for (; id !== undefined; id = parents.get(id)) stack.push(byId.get(id).callFrame)
    return stack
  }
  const runtimeNames = new Set(['(garbage collector)', '(idle)', '(program)'])
  const categoryOf = (frame) => {
    if (['node:inspector', 'node:inspector/promises'].includes(frame.url)) return 'harness'
    if ((frame.url === '' && runtimeNames.has(frame.functionName)) || frame.url.startsWith('node:')) return 'runtime'
    const actual = identity(frame)
    return actual ? definitions.get(tuple(actual)) ?? 'unknown' : 'unknown'
  }
  const exclusive = {}, inclusive = {}, operationExclusive = {}, nearestOwned = {}, unknownFrames = new Map()
  let operationSamples = 0, usefulSamples = 0, classifiedSamples = 0
  const add = (rows, name, delta) => {
    rows[name] ??= { samples: 0, intervalWeightedEstimateUs: 0 }
    rows[name].samples++; rows[name].intervalWeightedEstimateUs += delta
  }
  for (let index = 0; index < profile.samples.length; index++) {
    const stack = stackFor(profile.samples[index]), delta = profile.timeDeltas[index]
    if (index === 0) { add(exclusive, 'framing', delta); continue }
    const opIndex = stack.findIndex((frame) => same(frame, manifest.boundaries.operation))
    const batchIndex = stack.findIndex((frame) => same(frame, manifest.boundaries.batch))
    if (opIndex >= 0 && batchIndex <= opIndex) throw new Error('operation boundary lacks batch ancestry')
    const inOperation = opIndex >= 0
    let category = categoryOf(stack[0])
    if (same(stack[0], manifest.boundaries.operation) || same(stack[0], manifest.boundaries.batch)) category = 'boundary'
    if (!inOperation && category !== 'runtime' && category !== 'unknown') category = 'harness'
    add(exclusive, category, delta)
    const nearest = stack.map(categoryOf).find((c) => !['unknown', 'runtime'].includes(c)) ?? category
    add(nearestOwned, nearest, delta)
    const memberships = new Set(stack.map(categoryOf).filter((c) => !['unknown', 'runtime'].includes(c)))
    if (inOperation) {
      operationSamples++
      add(operationExclusive, category, delta)
      if (!reserved.has(category)) { usefulSamples++; classifiedSamples++ }
      memberships.add('operation')
    }
    for (const member of memberships) add(inclusive, member, delta)
    if (category === 'unknown') {
      const frame = stack[0], key = JSON.stringify(frame)
      const row = unknownFrames.get(key) ?? { frame, samples: 0, intervalWeightedEstimateUs: 0 }
      row.samples++; row.intervalWeightedEstimateUs += delta; unknownFrames.set(key, row)
    }
  }
  const denominator = profile.samples.length - 1
  const ratio = denominator ? classifiedSamples / denominator : 0
  return {
    schema: 'lsp-exact-source-cpu-attribution-v1', artifactSha256: expectedSha256,
    sampleCount: profile.samples.length, operationSamples, usefulSamples, classifiedSamples,
    coverage: { numerator: classifiedSamples, denominator, ratio },
    adequate: usefulSamples >= 200 && ratio >= 0.8,
    exclusive, operationExclusive, inclusive, nearestOwned,
    coverageFormula: 'Exact owned operation leaf observations / all post-framing observations, including detached runtime/GC and unknown. Useful count equals numerator. Nearest-owned and inclusive rows do not confer coverage.',
    exclusiveAssignment: 'Exact owned leaf. Unknown source/native leaves remain unknown; operation wrappers cannot confer coverage on descendants.',
    intervalEstimate: 'Observed sample intervals, not exact CPU shares; first framing interval and trailing residual kept separate.',
    clock: validated.clock, framing: { samples: 1, intervalWeightedEstimateUs: profile.timeDeltas[0], stack: stackFor(profile.samples[0]) },
    unknownFrames: [...unknownFrames.values()],
  }
}
