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

export function createPairedSchedule(cells, { repeatCount, participants, phases }) {
  if (!Number.isInteger(repeatCount) || repeatCount < 2 || repeatCount > 5) {
    throw new RangeError('paired repeat count must be between 2 and 5')
  }
  if (!Array.isArray(participants) || participants.length !== 2 || new Set(participants).size !== 2 || participants.some((item) => typeof item !== 'string' || !item)) {
    throw new TypeError('paired schedule requires two distinct participant names')
  }
  if (!Array.isArray(phases) || phases.length === 0 || new Set(phases).size !== phases.length) {
    throw new TypeError('paired schedule requires unique phase names')
  }
  const cellIds = cells.map(({ id }) => id)
  if (cellIds.some((id) => typeof id !== 'string' || !id) || new Set(cellIds).size !== cellIds.length) {
    throw new TypeError('paired schedule requires unique logical cell IDs')
  }
  const schedule = []
  for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
    const cases = repeatIndex % 2 === 1 ? cells : [...cells].reverse()
    const order = repeatIndex % 2 === 1 ? participants : [...participants].reverse()
    for (const cell of cases) {
      for (const phase of phases) {
        for (const participant of order) {
          const observationId = `${cell.id}:repeat:${repeatIndex}:${participant}:${phase}`
          schedule.push({ cellId: cell.id, repeatIndex, participant, phase, observationId })
        }
      }
    }
  }
  return schedule
}

export function selectPairedSchedule(plannedSchedule, selectedCellIds) {
  const selected = new Set(selectedCellIds)
  if (selected.size !== selectedCellIds.length) throw new Error('selected cell IDs must be unique')
  const plannedCells = new Set(plannedSchedule.map(({ cellId }) => cellId))
  if ([...selected].some((cellId) => !plannedCells.has(cellId))) throw new Error('selection contains an unplanned cell ID')
  return plannedSchedule.filter((item) => selected.has(item.cellId))
}

export function finalizeScheduleLedger(plannedSchedule, selectedSchedule, completedIds = [], failedIds = []) {
  const ids = (schedule) => schedule.map(({ observationId }) => observationId)
  const planned = ids(plannedSchedule)
  const selected = ids(selectedSchedule)
  const completedSet = new Set(completedIds)
  const failedSet = new Set(failedIds)
  if (new Set(planned).size !== planned.length || new Set(selected).size !== selected.length) {
    throw new Error('schedule contains duplicate observation IDs')
  }
  if (selected.some((id) => !planned.includes(id))) throw new Error('selected schedule contains an unplanned observation')
  if (completedSet.size !== completedIds.length || failedSet.size !== failedIds.length) throw new Error('observation ledger contains duplicate status IDs')
  if ([...completedSet].some((id) => !selected.includes(id)) || [...failedSet].some((id) => !selected.includes(id))) {
    throw new Error('observation ledger contains a nonselected ID')
  }
  if ([...completedSet].some((id) => failedSet.has(id))) throw new Error('observation cannot be both completed and failed')
  return {
    planned,
    selected,
    completed: selected.filter((id) => completedSet.has(id)),
    failed: selected.filter((id) => failedSet.has(id)),
    pending: selected.filter((id) => !completedSet.has(id) && !failedSet.has(id)),
    notSelected: planned.filter((id) => !selected.includes(id))
  }
}

export function finalizeMeasurementReport({
  preflightComplete,
  batch,
  participants,
  protocol,
  plannedCellIds,
  selectedCellIds,
  plannedSchedule,
  selectedSchedule,
  phaseLedger,
  failedPhases,
  completedPhaseIds,
  candidateArtifactsBefore,
  candidateArtifactsAfter,
  serverArtifactsBefore,
  serverArtifactsAfter,
  eligibility,
  semanticComparisons,
  rawObservations,
  semanticPreflight,
  elapsedMs
}) {
  const allPhases = preflightComplete && phaseLedger.pending.length === 0 && phaseLedger.failed.length === 0
  const completedPhaseSet = new Set(completedPhaseIds)
  const completedCells = selectedCellIds.filter((id) => selectedSchedule.filter((item) => item.cellId === id)
    .every((item) => completedPhaseSet.has(item.observationId)))
  const failedCells = selectedCellIds.filter((id) => failedPhases.some(({ id: failedId }) => failedId.startsWith(`${id}:`)))
  const cellLedger = {
    planned: plannedCellIds,
    selected: selectedCellIds,
    completed: completedCells,
    failed: failedCells,
    pending: selectedCellIds.filter((id) => !completedCells.includes(id) && !failedCells.includes(id)),
    notSelected: plannedCellIds.filter((id) => !selectedCellIds.includes(id))
  }
  return {
    kind: 'lsp-measurement',
    status: allPhases ? 'completed' : 'incomplete',
    scoredMeasurement: true,
    batch,
    participants,
    candidateArtifactsBefore,
    candidateArtifactsAfter,
    serverArtifactsBefore,
    serverArtifactsAfter,
    protocol,
    plannedCellCount: plannedCellIds.length,
    planned: plannedCellIds,
    selected: selectedCellIds,
    notSelected: cellLedger.notSelected,
    eligibility,
    cells: cellLedger,
    semanticComparisons,
    phases: { ...phaseLedger, schedule: plannedSchedule, selectedSchedule },
    failedPhases,
    rawObservations,
    semanticPreflight,
    elapsedMs,
    measurementClaim: allPhases ? 'raw observations only; no optimization conclusion is made by the harness' : null
  }
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
  for (const key of ['workerId', 'observationId', 'head', 'cellId', 'participant', 'phase']) {
    if (result[key] !== expected[key]) throw new Error(`measurement worker ${key} mismatch`)
  }
  if (!Number.isInteger(result.repeatIndex) || result.repeatIndex !== expected.repeatIndex) {
    throw new Error('measurement worker repeat index mismatch')
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
