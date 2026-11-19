import { test } from 'vitest'
import assert from 'node:assert/strict'
import { collectReferenceCpu } from '../../../scripts/compatibility/lsp-reference-cpu-collector.mjs'
import { CPU_PROTOCOL, referenceCpuSchedule, runReferenceCpuCampaign } from '../../../scripts/compatibility/lsp-reference-cpu-campaign.mjs'

function fakeSession(events: unknown[], fail?: string) {
  return { connect() { events.push('connect') }, disconnect() { events.push('disconnect') },
    post(method: string, params: object, callback: (error: Error | null, result: { profile?: { startTime: number; endTime: number } }) => void) {
      events.push([method, params])
      callback(fail === method ? new Error('inspector broke') : null, method === 'Profiler.stop' ? { profile: { startTime: 10, endTime: 100 } } : {})
    } }
}

test('fixed warmups precede sampling; clocks surround exactly 1000 ordinary operations and retain only latest', async () => {
  const events: unknown[] = []
  let operations = 0
  let cpu = 0
  let wall = 0n
  const result = await collectReferenceCpu({ operation() { events.push('operation'); return ++operations },
    session: fakeSession(events), hrtime() { events.push('wall'); return wall++ * 1000n },
    cpuUsage() { events.push('cpu'); return { user: cpu++ * 10, system: 2 } } })
  assert.equal(operations, 1003)
  assert.equal(result.result, 1003)
  assert.equal(result.completedOperations, 1000)
  assert.deepEqual(events.slice(0, 7), ['operation', 'operation', 'operation', 'connect', ['Profiler.enable', {}], ['Profiler.setSamplingInterval', { interval: 1000 }], ['Profiler.start', {}]])
  assert.deepEqual(events.slice(7, 10), ['wall', 'cpu', 'operation'])
  assert.deepEqual(events.slice(-5), ['cpu', 'wall', ['Profiler.stop', {}], ['Profiler.disable', {}], 'disconnect'])
  assert.equal(result.clocks.loopWallNs, '1000')
  assert.equal(result.clocks.processUserUs, 10)
})

test('thrown operation stops batch, reports completed count and stops Inspector before returning', async () => {
  const events: unknown[] = []
  let count = 0
  const result = await collectReferenceCpu({ operation() { if (++count === 8) throw new Error('parse failed'); return count }, session: fakeSession(events) })
  assert.equal(result.completedOperations, 4)
  assert.equal(result.result, 7)
  assert.match(result.operationError?.message ?? '', /parse failed/)
  assert.equal(events.filter(event => Array.isArray(event) && event[0] === 'Profiler.stop').length, 1)
  assert.equal(events.at(-1), 'disconnect')
})

test('Inspector setup failure never starts measured operations and disconnects', async () => {
  const events: unknown[] = []
  let count = 0
  await assert.rejects(collectReferenceCpu({ operation() { count++ }, session: fakeSession(events, 'Profiler.start') }), /inspector broke/)
  assert.equal(count, 3)
  assert.equal(events.at(-1), 'disconnect')
})

const receipt = { completedOperations: 1000, receiptSha256: 'receipt', artifactSha256: 'artifact', cleanup: 'retained', adequate: true }
async function campaign({ advance = 0, setup = 0, failIndex = -1, inadequate = -1 } = {}) {
  let time = setup
  let launches = 0
  const timeouts: number[] = []
  const states: import('../../../scripts/compatibility/lsp-reference-cpu-campaign.mjs').CampaignReport[] = []
  const report = await runReferenceCpuCampaign({ plan: { sha256: 'plan' }, startedAt: 0, now: () => time,
    persist(value) { states.push(structuredClone(value)) },
    launch(_row, timeout) { timeouts.push(timeout); const index = launches++; time += advance;
      return index === failIndex ? { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT', message: 'timed out' } } : { status: 0, signal: null } },
    validate() { return { ...receipt, adequate: launches - 1 !== inadequate } } })
  return { report, launches, timeouts, states }
}

test('campaign freezes original forward/reverse six-child schedule with persisted transitions', async () => {
  const { report, states } = await campaign()
  assert.equal(report.status, 'completed')
  assert.deepEqual(report.ledger.map(row => row.fixture), referenceCpuSchedule().map(row => row.fixture))
  assert.equal(states[0].ledger.filter(row => row.state === 'pending').length, 6)
  assert.equal(states.filter(state => state.ledger.some(row => row.state === 'running')).length, 6)
  assert.equal(CPU_PROTOCOL.externalGuardMs, 65000)
})

test('child timeout preserves first failure, cleanup unknown, and remaining pending IDs without retry', async () => {
  const { report, launches } = await campaign({ failIndex: 1 })
  assert.equal(launches, 2)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.ledger[1].timeout, true)
  assert.equal(report.ledger[1].signal, 'SIGKILL')
  assert.equal(report.ledger[1].cleanup, 'unknown')
  assert.equal(report.ledger.slice(2).every(row => row.state === 'pending'), true)
})

test('shared inner budget never resets and each timeout clamps to remaining setup-inclusive outer budget', async () => {
  const { timeouts, launches, report } = await campaign({ setup: 20000, advance: 10000 })
  assert.deepEqual(timeouts, [40000, 30000, 20000, 10000])
  assert.equal(launches, 4)
  assert.equal(report.status, 'incomplete')
  const inner = await campaign({ advance: 10000 })
  assert.deepEqual(inner.timeouts, [49000, 39000, 29000, 19000, 9000])
  assert.equal(inner.report.ledger[5].state, 'pending')
})

test('inadequacy stops immediately without topping up and preserves hashes/count', async () => {
  const { report, launches } = await campaign({ inadequate: 0 })
  assert.equal(launches, 1)
  assert.equal(report.ledger[0].completedOperations, 1000)
  assert.equal(report.ledger[0].artifactSha256, 'artifact')
  assert.equal(report.ledger[1].state, 'pending')
})

test('setup exhaustion launches nothing and preserves all planned rows', async () => {
  const { report, launches } = await campaign({ setup: 60000 })
  assert.equal(launches, 0)
  assert.equal(report.ledger.every(row => row.state === 'pending'), true)
  assert.match(report.firstFailure?.reason ?? '', /budget exhausted/)
})


test('slow running-state persistence exhausts outer budget before spawn', async () => {
  let time = 0;
  let launches = 0;
  const result = await runReferenceCpuCampaign({ plan: { sha256: 'plan' }, startedAt: 0, now: () => time,
    persist(report) { if (report.ledger.some(row => row.state === 'running')) time = 60001 },
    launch() { launches++; return { status: 0, signal: null } }, validate() { return receipt } });
  assert.equal(launches, 0);
  assert.equal(result.ledger[0].state, 'incomplete');
  assert.equal(result.ledger[0].cleanup, 'not-started');
  assert.equal(result.ledger.slice(1).every(row => row.state === 'pending'), true);
});

test('a non-Error operation throw retains the completed count and latest result', async () => {
  let count = 0;
  const result = await collectReferenceCpu({ operation() { if (++count === 5) throw null; return count }, session: fakeSession([]) });
  assert.equal(result.completedOperations, 1);
  assert.equal(result.result, 4);
  assert.equal(result.operationError?.name, 'NonErrorThrown');
});

test('identity preparation failure preserves the prepopulated pending ledger without launch', async () => {
  let launches = 0;
  const snapshots: string[][] = [];
  const result = await runReferenceCpuCampaign({ plan: { sha256: 'plan' }, startedAt: 0, now: () => 0,
    prepare() { throw new Error('physical identity changed') },
    persist(report) { snapshots.push(report.ledger.map(row => row.state)) },
    launch() { launches++; return { status: 0, signal: null } }, validate() { return receipt } });
  assert.equal(launches, 0);
  assert.equal(snapshots.length, 2);
  assert.equal(result.ledger.every(row => row.state === 'pending'), true);
  assert.match(result.firstFailure?.reason ?? '', /physical identity changed/);
});

test('invalid loop clocks preserve captured profile, completed operations and serializable snapshots', async () => {
  const events: unknown[] = [];
  let wallCall = 0;
  let cpuCall = 0;
  const result = await collectReferenceCpu({ operation: () => 'latest', session: fakeSession(events),
    hrtime: () => wallCall++ === 0 ? 10n : 5n,
    cpuUsage: () => cpuCall++ === 0 ? { user: 10, system: 2 } : { user: Number.POSITIVE_INFINITY, system: 1 } });
  assert.equal(result.completedOperations, 1000);
  assert.equal(result.result, 'latest');
  assert.equal(result.clocks.valid, false);
  assert.equal(result.clocks.failure, 'invalid loop clock');
  assert.equal(result.clocks.loopWallNs, '-5');
  assert.equal(result.clocks.processUserUs, 'Infinity');
  assert.equal(result.clocks.processSystemUs, -1);
  assert.deepEqual(result.clocks.snapshots, { wallStartNs: '10', wallEndNs: '5',
    cpuStart: { user: 10, system: 2 }, cpuEnd: { user: 'Infinity', system: 1 } });
  assert.equal(result.profile.startTime, 10);
  assert.doesNotThrow(() => JSON.stringify(result.clocks));
  assert.equal(events.filter(event => Array.isArray(event) && event[0] === 'Profiler.stop').length, 1);
  assert.equal(events.at(-1), 'disconnect');
});
