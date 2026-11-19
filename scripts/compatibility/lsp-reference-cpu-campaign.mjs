export const CPU_PROTOCOL = Object.freeze({ schema: 'lsp-reference-cpu-v1', warmups: 3, iterations: 1000,
  sampleIntervalUs: 1000, outerBudgetMs: 60000, innerBudgetMs: 49000, externalGuardMs: 65000,
  retries: 0, participant: 'server-reference', uniqueKeys: true, documentMode: 'absent' })

export function referenceCpuSchedule() {
  const shapes = ['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform']
  return [...shapes, ...shapes.toReversed()].map((fixture, index) => ({ fixture, repeat: index < 3 ? 1 : 2,
    id: `reference-cpu:${fixture}:repeat:${index < 3 ? 1 : 2}` }))
}

export async function runReferenceCpuCampaign({ plan, startedAt, now, launch, validate, persist, prepare = () => {} }) {
  const schedule = referenceCpuSchedule()
  const report = { schema: CPU_PROTOCOL.schema, status: 'incomplete', scoredMeasurement: false,
    interpretation: 'reference diagnostic observations only; no optimization, eligibility or universal CPU ceiling claim',
    clockScope: { outer: 'process performance.now origin, including CLI setup', inner: 'first child launch; never reset' }, planSha256: plan.sha256,
    protocol: CPU_PROTOCOL, firstFailure: null, ledger: schedule.map(item => ({ ...item, state: 'pending',
      completedOperations: 0, timeout: false, signal: null, cleanup: 'not-started', receiptSha256: null, artifactSha256: null })) }
  await persist(report)
  try { await prepare() } catch (error) {
    report.firstFailure = { id: report.ledger[0].id, reason: error.message }
    await persist(report)
    return report
  }
  let innerStartedAt = null
  for (const row of report.ledger) {
    const remainingOuter = CPU_PROTOCOL.outerBudgetMs - (now() - startedAt)
    const remainingInner = innerStartedAt === null ? CPU_PROTOCOL.innerBudgetMs : CPU_PROTOCOL.innerBudgetMs - (now() - innerStartedAt)
    const timeoutMs = Math.floor(Math.min(remainingOuter, remainingInner))
    if (timeoutMs <= 0) { report.firstFailure = { id: row.id, reason: 'budget exhausted before launch' }; break }
    row.state = 'running'
    row.cleanup = 'unknown'
    row.timeoutMs = timeoutMs
    await persist(report)
    let child
    try {
      const launchAt = now()
      const launchTimeout = Math.floor(Math.min(CPU_PROTOCOL.outerBudgetMs - (launchAt - startedAt),
        innerStartedAt === null ? CPU_PROTOCOL.innerBudgetMs : CPU_PROTOCOL.innerBudgetMs - (launchAt - innerStartedAt)))
      if (launchTimeout <= 0) { row.cleanup = 'not-started'; throw new Error('budget exhausted during running-state persistence') }
      row.timeoutMs = launchTimeout
      if (innerStartedAt === null) innerStartedAt = launchAt
      child = await launch(row, launchTimeout)
      row.signal = child.signal ?? null
      row.timeout = child.error?.code === 'ETIMEDOUT'
      if (child.error || child.status !== 0 || child.signal) throw new Error(child.error?.message ?? `child exit ${child.status}, signal ${child.signal}`)
      const receipt = await validate(child, row)
      row.completedOperations = receipt.completedOperations
      row.receiptSha256 = receipt.receiptSha256
      row.artifactSha256 = receipt.artifactSha256
      row.cleanup = receipt.cleanup
      row.clocks = receipt.clocks ?? null
      row.audit = receipt.audit ?? null
      if (now() - startedAt >= CPU_PROTOCOL.outerBudgetMs || now() - innerStartedAt >= CPU_PROTOCOL.innerBudgetMs) throw new Error('budget exhausted after child')
      if (!receipt.adequate) throw new Error(receipt.failure ?? 'sampling screens inadequate; inconclusive')
      row.state = 'completed'
    } catch (error) {
      row.state = 'incomplete'
      report.firstFailure = { id: row.id, reason: error.message }
      await persist(report)
      break
    }
    await persist(report)
  }
  report.elapsedMs = now() - startedAt
  report.innerElapsedMs = innerStartedAt === null ? null : now() - innerStartedAt
  if (!report.firstFailure && report.ledger.every(row => row.state === 'completed')) report.status = 'completed'
  await persist(report)
  return report
}
