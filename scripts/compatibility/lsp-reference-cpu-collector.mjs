import inspector from 'node:inspector'

const request = (session, method, params = {}) => new Promise((resolve, reject) => {
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result))
})

export function runProfiledOperation(operation) {
  return operation()
}

export function runProfiledBatch(operation, holder) {
  for (let index = 0; index < 1000; index++) {
    holder.result = runProfiledOperation(operation)
    holder.completedOperations++
  }
}

export async function collectReferenceCpu({ operation, session = new inspector.Session(),
  hrtime = () => process.hrtime.bigint(), cpuUsage = () => process.cpuUsage() }) {
  for (let index = 0; index < 3; index++) operation()
  const holder = { result: undefined, completedOperations: 0 }
  let started = false
  let stopped = false
  session.connect()
  try {
    await request(session, 'Profiler.enable')
    await request(session, 'Profiler.setSamplingInterval', { interval: 1000 })
    await request(session, 'Profiler.start')
    started = true
    let operationError = null
    const wallStart = hrtime()
    const cpuStart = cpuUsage()
    try { runProfiledBatch(operation, holder) } catch (error) { operationError = error instanceof Error ? { name: error.name, message: error.message } : { name: 'NonErrorThrown', message: typeof error === 'string' ? error : 'operation threw a non-Error value' } }
    const cpuEnd = cpuUsage()
    const wallEnd = hrtime()
    const { profile } = await request(session, 'Profiler.stop')
    stopped = true
    const wallNs = wallEnd - wallStart
    const userUs = cpuEnd.user - cpuStart.user
    const systemUs = cpuEnd.system - cpuStart.system
    const valid = wallStart >= 0n && wallEnd >= wallStart && [cpuStart.user, cpuStart.system, cpuEnd.user, cpuEnd.system, userUs, systemUs].every(value => Number.isFinite(value) && value >= 0)
    const safeScalar = value => Number.isFinite(value) ? value : String(value)
    return { profile, result: holder.result, completedOperations: holder.completedOperations, operationError,
      warmups: 3, iterations: 1000, sampleIntervalUs: 1000,
      clocks: { valid, failure: valid ? null : 'invalid loop clock',
        snapshots: { wallStartNs: String(wallStart), wallEndNs: String(wallEnd),
          cpuStart: { user: safeScalar(cpuStart.user), system: safeScalar(cpuStart.system) },
          cpuEnd: { user: safeScalar(cpuEnd.user), system: safeScalar(cpuEnd.system) } },
        loopWallNs: String(wallNs), processUserUs: safeScalar(userUs), processSystemUs: safeScalar(systemUs),
        snapshotOrder: ['hrtime-start', 'cpuUsage-start', 'batch', 'cpuUsage-end', 'hrtime-end'],
        inspector: { startTime: profile.startTime, endTime: profile.endTime, deltaUs: profile.endTime - profile.startTime },
        relationship: 'separate clocks; no shared epoch or per-operation timestamps asserted',
        scope: 'process CPU includes all threads; loop wall includes scheduling and sampling overhead' } }
  } finally {
    if (started && !stopped) await request(session, 'Profiler.stop').catch(() => {})
    await request(session, 'Profiler.disable').catch(() => {})
    session.disconnect()
  }
}
