import { createHash } from 'node:crypto'

export function verifyInputBytes(bytes, expectedInputSha256) {
  const inputSha256 = createHash('sha256').update(bytes).digest('hex')
  if (inputSha256 !== expectedInputSha256) throw new Error('measurement worker source input checksum mismatch')
  return { inputSha256, source: bytes.toString('utf8') }
}

export function snapshotPublicValue(value) {
  const seen = new Map()
  let nextReference = 0
  function visit(item) {
    if (item === null) return { type: 'null' }
    const kind = typeof item
    if (kind === 'undefined') return { type: 'undefined' }
    if (kind === 'string' || kind === 'boolean') return { type: kind, value: item }
    if (kind === 'number') {
      return { type: kind, value: Number.isNaN(item) ? 'NaN' : Object.is(item, -0) ? '-0' : String(item) }
    }
    if (kind === 'bigint') return { type: kind, value: item.toString() }
    if (kind === 'symbol' || kind === 'function') return { type: kind }

    if (seen.has(item)) return { type: 'reference', id: seen.get(item) }
    const id = nextReference++
    seen.set(item, id)
    if (Array.isArray(item)) return { type: 'array', id, items: item.map(visit) }
    if (item instanceof Date) return { type: 'date', id, value: Number.isNaN(item.getTime()) ? 'invalid' : item.toISOString() }
    if (item instanceof Map) return { type: 'map', id, entries: [...item].map(([key, value]) => [visit(key), visit(value)]) }
    if (item instanceof Set) return { type: 'set', id, values: [...item].map(visit) }
    return { type: 'object', id, entries: Object.keys(item).map((key) => [key, visit(item[key])]) }
  }
  return visit(value)
}

export function semanticOutcomesEqual(left, right) {
  if (!left || !right) return false
  const publicFields = (outcome) => ({ documents: outcome.documents, lineStarts: outcome.lineStarts ?? [] })
  return JSON.stringify(publicFields(left)) === JSON.stringify(publicFields(right))
}

export function evaluateSemanticPair(policy, candidate, reference) {
  const semanticAgreement = candidate && reference ? semanticOutcomesEqual(candidate, reference) : null
  if (policy === 'literal-default') {
    return { semanticAgreement, performanceEligible: false, reason: 'provider literal uniqueKeys defaults are not aligned' }
  }
  if (semanticAgreement !== true) {
    return { semanticAgreement, performanceEligible: false, reason: semanticAgreement === false
      ? 'candidate/reference semantic preflight differs'
      : 'candidate/reference semantic preflight is incomplete' }
  }
  return { semanticAgreement: true, performanceEligible: true, reason: null }
}

export function isMatchedPolicySemanticMismatch(policy, eligibility) {
  return policy !== 'literal-default' && eligibility.semanticAgreement === false
}

export function expectedPhaseCounts(phase, warmups, iterations) {
  if (phase === 'semantic-only' || phase === 'isolated-peak-rss') return { warmups: 0, iterations: 1, resultCount: 1 }
  if (phase === 'cpu-wall' || phase === 'retained-heap') return { warmups, iterations, resultCount: iterations }
  throw new Error(`unknown measurement phase ${phase}`)
}

export function runMeasurementPhase({
  phase,
  operation,
  warmups = 3,
  iterations = 25,
  now = () => performance.now(),
  cpuUsage = () => process.cpuUsage(),
  memoryUsage = () => process.memoryUsage(),
  resourceUsage = () => process.resourceUsage(),
  collectGarbage = globalThis.gc,
  summarize = (result) => result,
  peakRssBytes = (maxRss) => maxRss * (process.platform === 'darwin' ? 1 : 1024)
}) {
  if (typeof operation !== 'function') throw new TypeError('measurement operation must be a function')
  if (!Number.isInteger(warmups) || warmups < 0 || !Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('warmups and iterations must be nonnegative/positive integers')
  }
  if (!['cpu-wall', 'retained-heap', 'isolated-peak-rss'].includes(phase)) throw new Error(`unknown measurement phase ${phase}`)
  if (phase === 'retained-heap' && typeof collectGarbage !== 'function') {
    throw new Error('retained-heap phase requires Node --expose-gc')
  }
  for (let index = 0; index < warmups; index++) operation()

  if (phase === 'cpu-wall') {
    const cpuStart = cpuUsage()
    const wallStart = now()
    let result
    for (let index = 0; index < iterations; index++) result = operation()
    const wallMs = now() - wallStart
    const cpuEnd = cpuUsage()
    const summary = summarize(result)
    return {
      phase,
      warmups,
      iterations,
      cpuMs: ((cpuEnd.user - cpuStart.user) + (cpuEnd.system - cpuStart.system)) / 1000,
      wallMs,
      resultCount: iterations,
      output: summary
    }
  }

  if (phase === 'retained-heap') {
    collectGarbage()
    const beforeHeapBytes = memoryUsage().heapUsed
    const retained = []
    for (let index = 0; index < iterations; index++) retained.push(operation())
    collectGarbage()
    const afterHeapBytes = memoryUsage().heapUsed
    const output = summarize(retained)
    return {
      phase,
      warmups,
      iterations,
      resultCount: retained.length,
      beforeHeapBytes,
      afterHeapBytes,
      retainedHeapBytes: afterHeapBytes - beforeHeapBytes,
      output
    }
  }

  if (phase === 'isolated-peak-rss') {
    const collect = typeof collectGarbage === 'function' ? collectGarbage : null
    if (collect) collect()
    const before = memoryUsage()
    const result = operation()
    const after = memoryUsage()
    const maxRss = resourceUsage().maxRSS
    return {
      phase,
      warmups: 0,
      iterations: 1,
      resultCount: 1,
      beforeRssBytes: before.rss,
      afterRssBytes: after.rss,
      processMaxRssBytes: peakRssBytes(maxRss),
      output: summarize(result)
    }
  }

  throw new Error(`unknown measurement phase ${phase}`)
}

export function validatePhaseResult(result, expected) {
  for (const key of ['workerId', 'head', 'cellId', 'participant', 'phase']) {
    if (result[key] !== expected[key]) throw new Error(`measurement worker ${key} mismatch`)
  }
  if (!/^[a-f0-9]{64}$/.test(result.inputSha256) || !/^[a-f0-9]{64}$/.test(result.outputSha256)) {
    throw new Error('measurement worker omitted valid input/output checksums')
  }
  if (result.inputSha256 !== expected.inputSha256) throw new Error('measurement worker input checksum mismatch')
  if (!Number.isInteger(result.resultCount) || result.resultCount !== expected.resultCount) {
    throw new Error('measurement worker result count mismatch')
  }
  for (const key of ['warmups', 'iterations']) {
    if (!Number.isInteger(result[key]) || result[key] !== expected[key]) {
      throw new Error(`measurement worker ${key} count mismatch`)
    }
  }
  return result
}

export function createCampaignBudget({ startedAt, now, outerBudgetMs }) {
  if (typeof now !== 'function' || !Number.isFinite(startedAt) || !Number.isFinite(outerBudgetMs)) {
    throw new TypeError('campaign budget requires a start time, clock, and finite limits')
  }
  return {
    remainingOuterMs: () => Math.max(0, outerBudgetMs - (now() - startedAt)),
    expired: () => now() - startedAt >= outerBudgetMs
  }
}
