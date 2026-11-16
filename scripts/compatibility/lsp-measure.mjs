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
  return result
}

export function createCampaignBudget({ startedAt, now, outerBudgetMs, innerBudgetMs }) {
  if (typeof now !== 'function' || !Number.isFinite(startedAt) || !Number.isFinite(outerBudgetMs) || !Number.isFinite(innerBudgetMs)) {
    throw new TypeError('campaign budget requires a start time, clock, and finite limits')
  }
  return {
    remainingOuterMs: () => Math.max(0, outerBudgetMs - (now() - startedAt)),
    remainingInnerMs: () => Math.max(0, innerBudgetMs - (now() - startedAt)),
    expired: () => now() - startedAt >= outerBudgetMs
  }
}
