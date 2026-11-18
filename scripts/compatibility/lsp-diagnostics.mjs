import { closeSync, linkSync, lstatSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs'
import inspector from 'node:inspector'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

function isReference(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}
export function validateDiagnosticRequest({ diagnostic, participant, fixture, policy, artifact }) {
  if (!['cpu-profile', 'graph-census', 'heap-snapshot', 'contract-header-budget'].includes(diagnostic)) throw new Error('unknown diagnostic mode')
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
  if (diagnostic === 'contract-header-budget' && participant !== 'server-reference') throw new Error('header budget requires server-reference')
  if (!['graph-census', 'contract-header-budget'].includes(diagnostic) && !artifact) throw new Error(`${diagnostic} requires a private artifact path`)
  if (['graph-census', 'contract-header-budget'].includes(diagnostic) && artifact) throw new Error('graph census does not create an artifact')
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

export function canonicalFreshArtifactPath(requestedPath, repositoryRoot) {
  const requestedAbsolute = resolve(requestedPath)
  const canonicalParent = realpathSync(dirname(requestedAbsolute))
  const destination = resolve(canonicalParent, basename(requestedAbsolute))
  const canonicalRepository = realpathSync(repositoryRoot)
  const fromRepository = relative(canonicalRepository, destination)
  const insideRepository = fromRepository === '' || (!isAbsolute(fromRepository)
    && fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`))
  if (insideRepository) throw new Error('raw diagnostic artifacts must be written outside the repository')
  try {
    lstatSync(destination)
    throw new Error('diagnostic artifact already exists; use a fresh private path')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return destination
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


export function createHeaderBudgetSchedule() {
  const fixtures = ['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform']
  return [1, 2].flatMap((repeatIndex) => (repeatIndex === 1 ? fixtures : [...fixtures].reverse()).map((fixture) => ({
    fixture, repeatIndex, observationId: `contract-header-budget:server-reference:${fixture}:repeat:${repeatIndex}`
  })))
}

const HEADER_RUNTIME = Object.freeze({
  node: 'v24.19.0', v8: '13.6.233.17-node.51', arch: 'x64',
  executableSha256: 'a4c7d261ae62215e73edd637711f09a545535226ae9932c3148342f0b027d56b',
  configSha256: '1370cb808f317b4aeec7f96b391bd3c7d4014b23d58ce6e6a02df88302a14014',
  headerSha256: 'eb74fc0740b7f858a03e319e077c1698d2083325f3154c67771b120fb48f8520'
})

export function observeHeaderRuntime() {
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const executable = realpathSync(process.execPath)
  const headers = resolve(dirname(executable), '../include/node')
  return {
    node: process.version, v8: process.versions.v8, arch: process.arch,
    executableSha256: digest(executable), configSha256: digest(resolve(headers, 'config.gypi')),
    headerSha256: digest(resolve(headers, 'v8-internal.h')),
    targetArch: process.config.variables.target_arch,
    pointerCompression: process.config.variables.v8_enable_pointer_compression,
    sandbox: process.config.variables.v8_enable_sandbox,
    execArgv: [...process.execArgv], nodeOptions: process.env.NODE_OPTIONS ?? ''
  }
}

export function validateHeaderRuntime(observed) {
  const failures = Object.entries(HEADER_RUNTIME).filter(([key, value]) => observed?.[key] !== value).map(([key]) => key)
  if (observed?.targetArch !== 'x64') failures.push('targetArch')
  for (const key of ['pointerCompression', 'sandbox']) if (observed?.[key] !== 0) failures.push(key)
  if (!Array.isArray(observed?.execArgv) || observed.execArgv.length !== 1 || observed.execArgv[0] !== '--expose-gc') failures.push('execArgv')
  if (observed?.nodeOptions !== '') failures.push('nodeOptions')
  return { verified: failures.length === 0, failures, observed,
    headers: failures.length === 0 ? { object: 24, array: 32 } : null,
    evidence: 'nodejs/node@cdc1b38d40cb567b7ad0b39c86addf830a0af0ae: deps/v8/include/v8-internal.h; deps/v8/src/objects/js-objects.tq; deps/v8/src/objects/js-array.tq' }
}

// Only these own-data edges describe the inventoried public representation. In particular,
// SingleYAMLDocument.internalDocument is a getter; its audited backing slot is read directly.
export function inventoryPublicIdentities(results, trustedPrototypes = new Set([Object.prototype, Array.prototype])) {
  const seen = new WeakMap()
  const identities = []
  const exclusions = []
  const processed = new WeakMap()
  let objects = 0
  let arrays = 0
  const data = (value, key, path, required = false) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      if (required) throw new Error(`missing public own-data path ${path}.${key}`)
      return undefined
    }
    return descriptor.value
  }
  const visit = (value, path, role, reason, required = true) => {
    if (value === null || value === undefined) {
      if (required) throw new Error(`missing public identity ${path}`)
      return
    }
    if (typeof value !== 'object') throw new Error(`invalid public identity ${path}`)
    if (!trustedPrototypes.has(Object.getPrototypeOf(value))) throw new Error(`unproved public representation ${path}`)
    const arrayRoles = ['result-documents', 'cst-array', 'provider-items', 'range', 'server-children', 'diagnostics']
    if (arrayRoles.includes(role) !== Array.isArray(value)) throw new Error(`invalid public representation ${path}`)
    let record = seen.get(value)
    if (!record) {
      record = { id: `public-${identities.length}`, kind: Array.isArray(value) ? 'array' : 'object', paths: [], reasons: [], categories: [] }
      seen.set(value, record)
      identities.push(record)
      if (Array.isArray(value)) arrays++
      else objects++
    }
    if (!record.categories.includes(role)) record.categories.push(role)
    if (!record.reasons.includes(reason)) record.reasons.push(reason)
    if (record.paths.length < 3 && !record.paths.includes(path)) record.paths.push(path)
    const roles = processed.get(value) ?? new Set()
    if (roles.has(role)) return
    roles.add(role)
    processed.set(value, roles)
    const edge = (key, childRole, why, mandatory = false) => {
      const child = data(value, key, path, mandatory)
      if (child !== null && child !== undefined) visit(child, `${path}.${key}`, childRole, why)
      else if (mandatory) throw new Error(`missing public identity ${path}.${key}`)
    }
    if (Array.isArray(value)) {
      if (role === 'range') return
      const childRole = { 'result-documents': 'single-document', 'cst-array': 'cst', 'provider-items': 'provider', 'server-children': 'server', diagnostics: 'diagnostic' }[role]
      for (let index = 0; index < value.length; index++) {
        const child = data(value, String(index), path, true)
        if (child !== null) visit(child, `${path}[${index}]`, childRole, 'mutable public array element')
      }
      return
    }
    if (role === 'result') {
      edge('documents', 'result-documents', 'returned document wrappers', true)
      edge('tokens', 'cst-array', 'returned full mutable CST stream', true)
    } else if (role === 'single-document') {
      edge('_internalDocument', 'document', 'audited own backing slot of public internalDocument getter', true)
      data(value, 'root', path, true)
      edge('root', 'server', 'eager unchanged converter root')
    } else if (role === 'document') {
      data(value, 'contents', path, true)
      edge('contents', 'provider', 'public mutable Document.contents')
      edge('range', 'range', 'public source range', true)
    } else if (role === 'provider') {
      const items = data(value, 'items', path)
      const key = Object.getOwnPropertyDescriptor(value, 'key')
      if (items !== undefined) edge('items', 'provider-items', 'unchanged converter iterates mutable collection items', true)
      else if (key) {
        data(value, 'key', path, true)
        data(value, 'value', path, true)
        edge('key', 'provider', 'public Pair.key')
        edge('value', 'provider', 'public Pair.value')
      } else {
        if (data(value, 'source', path) === undefined) data(value, 'value', path, true)
      }
      if (!key) edge('range', 'range', 'converter consumes node source range', true)
      edge('srcToken', 'cst', 'public keepSourceTokens link to original CST identity', true)
    } else if (role === 'server') {
      const type = data(value, 'type', path, true)
      edge('internalNode', 'provider', 'unchanged converter backlink', true)
      edge('parent', 'server', 'observable parent identity')
      if (type === 'object') edge('properties', 'server-children', 'public object children own storage', true)
      else if (type === 'array') edge('items', 'server-children', 'public array children own storage', true)
      else if (type === 'property') {
        edge('keyNode', 'server', 'public property key', true)
        data(value, 'valueNode', path, true)
        edge('valueNode', 'server', 'public property value')
      } else if (!['string', 'number', 'boolean', 'null'].includes(type)) throw new Error(`unknown server node ${path}`)
    } else if (role === 'cst') {
      const type = data(value, 'type', path)
      if (type === undefined) data(value, 'start', path, true)
      const tokenTypes = ['byte-order-mark', 'doc-mode', 'doc-start', 'space', 'comment', 'newline', 'directive-line', 'anchor', 'tag', 'seq-item-ind', 'explicit-key-ind', 'map-value-ind', 'flow-map-start', 'flow-map-end', 'flow-seq-start', 'flow-seq-end', 'flow-error-end', 'comma', 'block-scalar-header', 'error', 'directive', 'document', 'doc-end', 'alias', 'scalar', 'single-quoted-scalar', 'double-quoted-scalar', 'block-scalar', 'block-map', 'block-seq', 'flow-collection']
      if (type !== undefined && !tokenTypes.includes(type)) throw new Error(`invalid CST type ${path}`)
      if (type === 'flow-collection') edge('start', 'cst', 'public flow collection opening token', true)
      else edge('start', 'cst-array', 'public CST document/item start sequence', type === 'document' || type === undefined)
      for (const key of ['end', 'sep', 'props']) edge(key, 'cst-array', 'public CST token or collection-item sequence', (type === 'flow-collection' && key === 'end') || (type === 'block-scalar' && key === 'props'))
      if (['block-map', 'block-seq', 'flow-collection'].includes(type)) data(value, 'items', path, true)
      edge('items', 'cst-array', 'public CST collection items')
      for (const key of ['key', 'value']) edge(key, 'cst', 'public CST collection-item subtree')
    } else if (role === 'diagnostic') {
      edge('pos', 'range', 'public diagnostic source positions', true)
    }
    for (const key of ['schema', 'options', 'directives', 'lineCounter', 'errors', 'warnings']) {
      if (isReference(data(value, key, path))) exclusions.push({ path: `${path}.${key}`, reason: 'outside justified public identity subset; not traversed' })
    }
  }
  results.forEach((result, index) => visit(result, `results[${index}]`, 'result', 'retained full operation result'))
  return { accounting: 'current public-identity header accounting; indispensability beyond fixed eager ordinary representation unproved',
    objects, arrays, identities, excluded: { observedEdges: exclusions,
      categories: ['unlisted/private own fields', 'schema and directives', 'prototypes and modules', 'alias/module caches', 'strings and string backing storage', 'property tables and array backing stores', 'caller TextDocument/editor state'] } }
}

export function summarizeHeaderBudget(inventory, runtime, beforeHeapBytes, afterHeapBytes, streams = 25) {
  const deltaHeapBytes = afterHeapBytes - beforeHeapBytes
  const headerBytes = runtime.verified ? inventory.objects * runtime.headers.object + inventory.arrays * runtime.headers.array : null
  return { beforeHeapBytes, afterHeapBytes, deltaHeapBytes, streams, deltaPerStreamBytes: deltaHeapBytes / streams,
    headerBytes, headerPerStreamBytes: headerBytes === null ? null : headerBytes / streams,
    tenfoldBudgetBytes: deltaHeapBytes / 10, hundredfoldBudgetBytes: deltaHeapBytes / 100,
    tenfoldBudgetPerStreamBytes: deltaHeapBytes / (10 * streams), hundredfoldBudgetPerStreamBytes: deltaHeapBytes / (100 * streams),
    headerToObservedBudgetRatio: deltaHeapBytes > 0 && headerBytes !== null ? headerBytes / deltaHeapBytes : null,
    interpretation: 'noisy post-GC operational budget, not retained ownership or an upper bound; current public headers do not establish a universal lower bound, reduction ceiling, candidate eligibility or feasibility' }
}
