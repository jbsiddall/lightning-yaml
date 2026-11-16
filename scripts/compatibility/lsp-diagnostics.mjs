import { closeSync, linkSync, openSync, statSync, unlinkSync, writeSync } from 'node:fs'
import inspector from 'node:inspector'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

function isReference(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}
export function validateDiagnosticRequest({ diagnostic, participant, fixture, policy, artifact }) {
  if (!['cpu-profile', 'graph-census', 'heap-snapshot'].includes(diagnostic)) throw new Error('unknown diagnostic mode')
  if (!['candidate', 'reference', 'server-candidate', 'server-reference'].includes(participant)) throw new Error('unknown diagnostic participant')
  if (!['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform'].includes(fixture)) {
    throw new Error('diagnostics accept only one original corpus fixture')
  }
  const serverMode = participant.startsWith('server-')
  const selectedPolicy = policy ?? (serverMode ? 'literal-default' : 'uniqueKeys-false')
  if (serverMode && selectedPolicy !== 'literal-default') throw new Error('actual-server diagnostics preserve literal server defaults')
  if (!serverMode && !['uniqueKeys-false', 'uniqueKeys-true'].includes(selectedPolicy)) {
    throw new Error('bare diagnostics require an explicit matched uniqueKeys policy')
  }
  if (diagnostic === 'cpu-profile' && (fixture !== 'github-actions-cmake-multi-platform' || (!serverMode && selectedPolicy !== 'uniqueKeys-false'))) {
    throw new Error('CPU profiles are predeclared only for GHA with bare uniqueKeys-false or actual-server literal defaults')
  }
  if (diagnostic === 'heap-snapshot' && (!serverMode || fixture !== 'github-actions-cmake-multi-platform')) {
    throw new Error('heap snapshots are predeclared only for actual-server GHA cases')
  }
  if (diagnostic === 'graph-census' && !serverMode) {
    throw new Error('graph census is predeclared only for actual-server cases')
  }
  if (diagnostic !== 'graph-census' && !artifact) throw new Error(`${diagnostic} requires a private artifact path`)
  if (diagnostic === 'graph-census' && artifact) throw new Error('graph census does not create an artifact')
  return { serverMode, policy: selectedPolicy, provider: participant.endsWith('candidate') ? 'candidate' : 'reference' }
}

export function createDiagnosticBudget({ startedAt, now, outerBudgetMs = 60_000, innerBudgetMs = 49_000 }) {
  if (typeof now !== 'function' || !Number.isFinite(startedAt) || !Number.isFinite(outerBudgetMs) || !Number.isFinite(innerBudgetMs)
    || outerBudgetMs <= 0 || innerBudgetMs <= 0 || innerBudgetMs >= 50_000) {
    throw new TypeError('diagnostic budget requires a clock and positive outer/<50s inner limits')
  }
  let innerStartedAt = null
  const remainingOuterMs = () => Math.max(0, outerBudgetMs - (now() - startedAt))
  const remainingInnerMs = () => innerStartedAt === null ? innerBudgetMs : Math.max(0, innerBudgetMs - (now() - innerStartedAt))
  const remainingWorkerMs = () => Math.min(remainingOuterMs(), remainingInnerMs())
  return {
    startInner() {
      if (innerStartedAt !== null) throw new Error('diagnostic inner budget already started')
      innerStartedAt = now()
      return innerStartedAt
    },
    remainingOuterMs,
    remainingInnerMs,
    remainingWorkerMs,
    expired: () => remainingWorkerMs() <= 0
  }
}

export function redactPrivatePaths(value) {
  if (typeof value === 'string') {
    return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^file:\/\//i.test(value)
      ? '<private-path>'
      : value
  }
  if (Array.isArray(value)) return value.map(redactPrivatePaths)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactPrivatePaths(child)]))
}

export function validateDiagnosticWorker(result, expected) {
  for (const key of ['kind', 'workerId', 'diagnostic', 'head', 'participant', 'fixture', 'policy', 'inputSha256']) {
    if (result[key] !== expected[key]) throw new Error(`diagnostic worker ${key} mismatch`)
  }
  if (result.kind !== 'lsp-diagnostic' || result.scoredMeasurement !== false) throw new Error('diagnostic worker returned the wrong result kind')
  if (!['completed', 'incomplete'].includes(result.status)) throw new Error('diagnostic worker status is invalid')
  if (result.status === 'incomplete' && (expected.diagnostic !== 'heap-snapshot'
    || result.diagnosticResult?.status !== 'incomplete'
    || !['removed', 'retained', 'unknown'].includes(result.diagnosticResult?.cleanupStatus))) {
    throw new Error('incomplete diagnostic worker cleanup status is invalid')
  }
  if (!/^[a-f0-9]{64}$/.test(result.inputSha256)) throw new Error('diagnostic worker input hash is invalid')
  if (result.diagnosticResult?.diagnostic !== expected.diagnostic) throw new Error('diagnostic result mode mismatch')
  const actual = result.provenance
  const provider = expected.provider
  if (!actual || actual.root !== provider.root || actual.name !== provider.name || actual.version !== provider.version
    || actual.packageJsonSha256 !== provider.packageJsonSha256 || (actual.lock?.sha256 ?? null) !== provider.lockSha256
    || actual.entry?.path !== provider.entryPath || actual.entry?.bytes !== provider.entryBytes || actual.entry?.sha256 !== provider.entrySha256
    || actual.closure?.count !== provider.closureCount || actual.closure?.sha256 !== provider.closureSha256) {
    throw new Error('diagnostic worker provider provenance mismatch')
  }
  const resolutions = result.resolutions
  if (!Array.isArray(resolutions)) throw new Error('diagnostic worker resolver evidence is invalid')
  if (!expected.serverMode) {
    if (resolutions.length !== 0) throw new Error('bare diagnostic unexpectedly returned server resolver evidence')
    return { resolutionCount: 0, targetsValidated: true, parentRootsValidated: true }
  }
  if (resolutions.length === 0) throw new Error('diagnostic server worker performed no yaml imports')
  const target = pathToFileURL(resolve(expected.entry)).href
  const serverRoot = resolve(expected.serverRoot)
  for (const item of resolutions) {
    if (item.specifier !== 'yaml' || item.target !== target || typeof item.parentURL !== 'string') {
      throw new Error('diagnostic server resolver target differs from selected provider')
    }
    let parentPath
    try { parentPath = resolve(fileURLToPath(item.parentURL)) }
    catch { throw new Error('diagnostic server resolver parent URL is invalid') }
    const parentRelative = relative(serverRoot, parentPath)
    if (!parentRelative || parentRelative === '..' || parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)) {
      throw new Error('diagnostic server resolver parent escaped the selected server root')
    }
  }
  return { resolutionCount: resolutions.length, targetsValidated: true, parentRootsValidated: true }
}

export function censusOwnGraph(roots, { classify = () => 'other', stringFields = [], excludedReferenceFields = [] } = {}) {
  const seen = new WeakSet()
  const counts = { objects: 0, arrays: 0, stringFieldOccurrences: 0, stringFieldCodeUnits: 0, categories: {} }
  const rootCounts = []
  let uniqueReferences = 0
  let nextGraphIdentity = 0
  const graphIdentityIds = new WeakMap()
  const graphIdentityId = (value) => {
    if (!graphIdentityIds.has(value)) graphIdentityIds.set(value, `graph-${nextGraphIdentity++}`)
    return graphIdentityIds.get(value)
  }
  const strings = new Set(stringFields)
  const excludedFields = new Set(excludedReferenceFields)
  const excludedReferences = Object.fromEntries([...excludedFields].map((field) => [field, { occurrences: 0, uniqueReferences: 0, identities: [], links: [] }]))
  const seenExcluded = new Map([...excludedFields].map((field) => [field, new WeakSet()]))
  const excludedIdentityIds = new WeakMap()
  let nextExcludedIdentity = 0
  const excludedIdentityCounts = new Map()
  const excludedTargets = new WeakSet()
  const discovered = new WeakSet()
  const discoveryStack = roots.map(({ value }) => value).filter(isReference)
  while (discoveryStack.length) {
    const value = discoveryStack.pop()
    if (discovered.has(value)) continue
    discovered.add(value)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !isReference(descriptor.value)) continue
      if (typeof key === 'string' && excludedFields.has(key)) excludedTargets.add(descriptor.value)
      else discoveryStack.push(descriptor.value)
    }
  }
  const stack = []
  for (const root of roots) {
    rootCounts.push({ name: root.name, kind: root.value === null ? 'null' : typeof root.value,
      ...(isReference(root.value) ? { referenceId: graphIdentityId(root.value) } : {}) })
    if (typeof root.value === 'string') {
      counts.stringFieldOccurrences++
      counts.stringFieldCodeUnits += root.value.length
    }
  }
  for (const root of [...roots].reverse()) stack.push(root.value)
  while (stack.length) {
    const value = stack.pop()
    if (!isReference(value) || seen.has(value) || excludedTargets.has(value)) continue
    seen.add(value)
    const ownerReferenceId = graphIdentityId(value)
    uniqueReferences++
    if (Array.isArray(value)) counts.arrays++
    else counts.objects++
    const category = classify(value)
    counts.categories[category] = (counts.categories[category] ?? 0) + 1
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
      const child = descriptor.value
      if (typeof key === 'string' && excludedFields.has(key)) {
        const summary = excludedReferences[key]
        summary.occurrences++
        if (isReference(child) && !seenExcluded.get(key).has(child)) {
          seenExcluded.get(key).add(child)
          summary.uniqueReferences++
        }
        if (isReference(child)) {
          if (!excludedIdentityIds.has(child)) excludedIdentityIds.set(child, `excluded-${nextExcludedIdentity++}`)
          const referencedIdentityId = excludedIdentityIds.get(child)
          excludedIdentityCounts.set(referencedIdentityId, (excludedIdentityCounts.get(referencedIdentityId) ?? 0) + 1)
          summary.links.push({ ownerReferenceId, ownerCategory: category, referencedIdentityId })
        }
        continue
      }
      if (typeof key === 'string' && strings.has(key) && typeof child === 'string') {
        counts.stringFieldOccurrences++
        counts.stringFieldCodeUnits += child.length
      }
      if (isReference(child)) stack.push(child)
    }
  }
  for (const field of excludedFields) {
    excludedReferences[field].identities = [...excludedIdentityCounts].map(([id, occurrences]) => ({ id, occurrences }))
  }
  return { ...counts, uniqueReferences, roots: rootCounts, excludedReferences }
}

export function classifyCpuSamples(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parent = new Map()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const categories = { lexerParser: 0, composition: 0, customCallbacks: 0, runtimeGc: 0, serverAst: 0, serverWrapper: 0, unassigned: 0 }
  const classifyFrame = (frame) => {
    const functionName = (frame.functionName ?? '').toLowerCase()
    const url = (frame.url ?? '').toLowerCase()
    const text = `${functionName} ${url}`
    if (/yamlparser07\.js|yaml-documents\.js/.test(url)) return 'serverWrapper'
    if (/ast-converter\.js/.test(url) && /^convert(ast|map|pair|seq|scalar|alias)$/.test(functionName)) return 'serverAst'
    if (/lexer|parser|parse|scanner|token/.test(functionName)) return 'lexerParser'
    if (/custom.?tag|resolve/.test(text)) return 'customCallbacks'
    if (/compose|scalar|tag|property/.test(text)) return 'composition'
    if (/\bgc\b|garbage|runtime|node:internal|v8::/.test(text)) return 'runtimeGc'
    return null
  }
  for (const sampleId of profile.samples ?? []) {
    let current = nodes.get(sampleId)
    let category = null
    while (current && !category) {
      category = classifyFrame(current.callFrame ?? {})
      current = nodes.get(parent.get(current.id))
    }
    categories[category ?? 'unassigned']++
  }
  const sampleCount = profile.samples?.length ?? 0
  const assignedSamples = sampleCount - categories.unassigned
  const usefulSamples = assignedSamples - categories.runtimeGc - categories.serverWrapper
  const classifiedCoverage = sampleCount === 0 ? 0 : assignedSamples / sampleCount
  return {
    sampleCount,
    assignedSamples,
    usefulSamples,
    classifiedCoverage,
    categories,
    attributionAssessment: usefulSamples < 200 || classifiedCoverage < 0.8
      ? 'insufficient-samples-or-coverage-for-fine-attribution'
      : 'sample-count-and-coverage-threshold-met'
  }
}

function request(session, method, params = {}) {
  return new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
}

export async function collectCpuProfile({ session = new inspector.Session(), operation, warmups = 3, iterations = 250, sampleIntervalUs = 1000 }) {
  if (typeof operation !== 'function') throw new TypeError('diagnostic operation must be a function')
  for (let index = 0; index < warmups; index++) operation()
  session.connect?.()
  try {
    await request(session, 'Profiler.enable')
    await request(session, 'Profiler.setSamplingInterval', { interval: sampleIntervalUs })
    await request(session, 'Profiler.start')
    for (let index = 0; index < iterations; index++) operation()
    const { profile } = await request(session, 'Profiler.stop')
    await request(session, 'Profiler.disable')
    session.disconnect?.()
    return { warmups, iterations, sampleIntervalUs, profile }
  } catch (error) {
    await request(session, 'Profiler.stop').catch(() => {})
    await request(session, 'Profiler.disable').catch(() => {})
    session.disconnect?.()
    throw error
  }
}

export function createFileSink(filePath, { unlink = unlinkSync, stat = statSync } = {}) {
  const partialPath = `${filePath}.${process.pid}.${randomUUID()}.partial`
  let descriptor = openSync(partialPath, 'wx')
  let published = false
  return {
    write(chunk) {
      const bytes = Buffer.from(chunk)
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset)
        if (written < 1) throw new Error('snapshot file sink made no write progress')
        offset += written
      }
      return true
    },
    async close() {
      closeSync(descriptor)
      descriptor = undefined
      linkSync(partialPath, filePath)
      published = true
      unlink(partialPath)
    },
    async abort() {
      if (descriptor !== undefined) try { closeSync(descriptor) } catch {}
      descriptor = undefined
      try { unlink(partialPath) } catch {}
      if (published) try { unlink(filePath) } catch {}
      const paths = published ? [partialPath, filePath] : [partialPath]
      const states = paths.map((path) => {
        try { stat(path); return true }
        catch (error) { return error.code === 'ENOENT' ? false : null }
      })
      if (states.includes(true)) return 'retained'
      if (states.every((state) => state === false)) return 'removed'
      return 'unknown'
    }
  }
}

export async function writeHeapSnapshot(filePath, { session = new inspector.Session(), createSink = createFileSink } = {}) {
  let sink
  let bytesWritten = 0
  let chunksReceived = 0
  let failure = null
  const queueChunk = (chunk) => {
    const chunkBytes = Buffer.byteLength(chunk)
    chunksReceived++
    if (failure) return
    try {
      if (sink.write(chunk) === false) {
        failure = new Error('snapshot sink refused an inspector chunk')
        return
      }
      bytesWritten += chunkBytes
    } catch (error) {
      failure = error
    }
  }
  try {
    sink = createSink(filePath)
    session.connect?.()
    session.on('HeapProfiler.addHeapSnapshotChunk', ({ params }) => queueChunk(params.chunk))
    await request(session, 'HeapProfiler.enable')
    await request(session, 'HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    await request(session, 'HeapProfiler.disable')
    if (failure) throw failure
    await sink.close()
    return { bytes: bytesWritten, chunks: chunksReceived }
  } catch (error) {
    let cleanupStatus = 'unknown'
    try {
      const status = await sink?.abort?.()
      if (['removed', 'retained', 'unknown'].includes(status)) cleanupStatus = status
    } catch {}
    const incomplete = new Error(`heap snapshot incomplete: ${error.message}`)
    incomplete.artifactState = { status: 'incomplete', bytesWritten, chunksReceived, cleanupStatus }
    throw incomplete
  } finally {
    try { session.disconnect?.() } catch {}
  }
}
