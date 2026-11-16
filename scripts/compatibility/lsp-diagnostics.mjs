import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import inspector from 'node:inspector'

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
  if (diagnostic !== 'graph-census' && !artifact) throw new Error(`${diagnostic} requires a private artifact path`)
  return { serverMode, policy: selectedPolicy, provider: participant.endsWith('candidate') ? 'candidate' : 'reference' }
}

export function censusOwnGraph(roots, { classify = () => 'other', stringFields = [] } = {}) {
  const seen = new WeakSet()
  const counts = { objects: 0, arrays: 0, strings: 0, stringCodeUnits: 0, categories: {} }
  const rootCounts = []
  let uniqueReferences = 0
  const strings = new Set(stringFields)
  const stack = []
  for (const root of roots) {
    stack.push(root.value)
    rootCounts.push({ name: root.name, kind: root.value === null ? 'null' : typeof root.value })
    if (typeof root.value === 'string') {
      counts.strings++
      counts.stringCodeUnits += root.value.length
    }
  }
  while (stack.length) {
    const value = stack.pop()
    if (!isReference(value) || seen.has(value)) continue
    seen.add(value)
    uniqueReferences++
    if (Array.isArray(value)) counts.arrays++
    else counts.objects++
    const category = classify(value)
    counts.categories[category] = (counts.categories[category] ?? 0) + 1
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
      const child = descriptor.value
      if (typeof key === 'string' && strings.has(key) && typeof child === 'string') {
        counts.strings++
        counts.stringCodeUnits += child.length
      }
      if (isReference(child)) stack.push(child)
    }
  }
  return { ...counts, uniqueReferences, roots: rootCounts }
}

export function classifyCpuSamples(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parent = new Map()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const categories = { lexerParser: 0, composition: 0, customCallbacks: 0, runtimeGc: 0, serverAst: 0, unassigned: 0 }
  const classifyFrame = (frame) => {
    const text = `${frame.functionName ?? ''} ${frame.url ?? ''}`.toLowerCase()
    if (/convertast|yamlparser07|singleyamldocument/.test(text)) return 'serverAst'
    if (/lexer|parser|parse\b|scanner|token/.test(text)) return 'lexerParser'
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
  return {
    sampleCount,
    categories,
    attributionAssessment: sampleCount < 200 ? 'insufficient-samples-for-fine-attribution' : 'sample-count-threshold-met'
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

export async function writeHeapSnapshot(filePath, { session = new inspector.Session() } = {}) {
  session.connect?.()
  const output = createWriteStream(filePath, { flags: 'wx' })
  const outputDone = finished(output)
  outputDone.catch(() => {})
  let bytes = 0
  let chunks = 0
  session.on('HeapProfiler.addHeapSnapshotChunk', ({ params }) => {
    bytes += Buffer.byteLength(params.chunk)
    chunks++
    output.write(params.chunk)
  })
  try {
    await request(session, 'HeapProfiler.enable')
    await request(session, 'HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    await request(session, 'HeapProfiler.disable')
    output.end()
    await outputDone
    return { bytes, chunks }
  } finally {
    session.disconnect?.()
    if (!output.closed) output.destroy()
  }
}
