#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openMeasurementOperation, assertDiagnosticGraph } from './bench-lsp.mjs'
import { assertYamlResolutions, sha256 } from './lsp-contract.mjs'
import { canonicalFreshArtifactPath, redactPrivatePaths } from './lsp-diagnostics.mjs'
import { collectReferenceCpu } from './lsp-reference-cpu-collector.mjs'
import { CPU_PROTOCOL, referenceCpuSchedule, runReferenceCpuCampaign } from './lsp-reference-cpu-campaign.mjs'
import { REFERENCE_ENTRY, SERVER_ROOT, referenceCpuIdentity, readPinnedPlan } from './lsp-reference-cpu-identity.mjs'
import { validateOwnershipManifest, auditOwnedCpuProfile } from './lsp-cpu-ownership.mjs'

const script = fileURLToPath(import.meta.url)
const repo = resolve(dirname(script), '../..')
const same = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} changed`) }
const writeFresh = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
const manifestAt = plan => {
  const bytes = readFileSync(plan.manifest.path)
  if (sha256(bytes) !== plan.manifest.sha256) throw new Error('ownership manifest digest changed')
  return validateOwnershipManifest(JSON.parse(bytes))
}

async function worker(config) {
  canonicalFreshArtifactPath(config.artifactPath, repo)
  canonicalFreshArtifactPath(config.receiptPath, repo)
  const plan = readPinnedPlan(config.planPath, config.planSha256)
  same(referenceCpuIdentity(repo), plan.identity, 'child physical identity')
  const manifest = manifestAt(plan)
  const row = plan.schedule[config.index]
  same(row, config.row, 'child schedule')
  const fixture = plan.identity.fixtures.find(item => item.id === row.fixture)
  const source = readFileSync(resolve(repo, fixture.localPath))
  if (source.length !== fixture.bytes || sha256(source) !== fixture.sha256) throw new Error('child input bytes changed')
  const opened = await openMeasurementOperation({ entry: REFERENCE_ENTRY, label: 'reference', serverMode: true,
    serverRoot: SERVER_ROOT, documentMode: 'absent', cellId: fixture.id }, source.toString('utf8'))
  let collected
  let failure = null
  try {
    collected = await collectReferenceCpu({ operation: opened.operation })
    if (!collected.clocks.valid) failure = collected.clocks.failure
    if (collected.operationError) failure = `operation threw ${collected.operationError.name}: ${collected.operationError.message}`
    if (!failure) {
      assertDiagnosticGraph(opened.api, collected.result, source.toString('utf8'), true, fixture.expectedDocuments)
      for (const single of collected.result.documents) {
        const options = single.internalDocument.options
        if (options.uniqueKeys !== true || options.keepSourceTokens !== true || options.version !== '1.2' || options.strict !== false) throw new Error('ordinary server options changed')
        same(options.customTags.map(tag => ({ tag: tag.tag, type: tag.type, returnType: tag.returnType ?? null })),
          [{ tag: '!count', type: 'scalar', returnType: 'number' }, { tag: '!record', type: 'mapping', returnType: 'object' },
            { tag: '!include', type: 'scalar', returnType: null }], 'effective custom tag policy')
      }
    }
    assertYamlResolutions(opened.serverResolution.resolutions, REFERENCE_ENTRY, SERVER_ROOT)
    same(referenceCpuIdentity(repo), plan.identity, 'post-operation physical identity')
  } catch (error) { failure = error.message }
  finally { opened.unregisterHook() }
  if (!collected) throw new Error(failure ?? 'collector returned no result')
  const profileBytes = Buffer.from(JSON.stringify(collected.profile))
  writeFileSync(config.artifactPath, profileBytes, { flag: 'wx', mode: 0o600 })
  const artifactSha256 = sha256(profileBytes)
  let audit = null
  try { audit = redactPrivatePaths(auditOwnedCpuProfile(profileBytes, artifactSha256, manifest)) } catch (error) { failure ??= error.message }
  const receipt = { schema: CPU_PROTOCOL.schema, status: failure ? 'incomplete' : 'completed', id: row.id,
    protocol: CPU_PROTOCOL, warmups: collected.warmups, iterations: collected.iterations, sampleIntervalUs: collected.sampleIntervalUs,
    physicalInputs: redactPrivatePaths(plan.identity),
    planSha256: config.planSha256, manifestSha256: plan.manifest.sha256, identitySha256: sha256(JSON.stringify(plan.identity)),
    inputSha256: fixture.sha256, documentCount: collected.result?.documents?.length ?? null,
    completedOperations: collected.completedOperations, clocks: collected.clocks, operationError: collected.operationError,
    artifactSha256, artifactBytes: profileBytes.length, audit, failure, cleanup: 'retained-private-artifact',
    provider: redactPrivatePaths(opened.provenance), resolutions: redactPrivatePaths(opened.serverResolution.resolutions),
    policy: { uniqueKeys: true, yamlVersion: '1.2', keepSourceTokens: true, strict: false,
      customTags: ['!count scalar:number', '!record mapping:object'],
      effectiveCustomTags: collected.result?.documents?.[0]?.internalDocument?.options?.customTags?.map(tag => ({ tag: tag.tag, type: tag.type, returnType: tag.returnType ?? null })) ?? null,
      verified: failure === null, callerTextDocument: 'absent' } }
  writeFresh(config.receiptPath, receipt)
  process.stdout.write(JSON.stringify({ receiptSha256: sha256(readFileSync(config.receiptPath)) }))
}

export async function main(argv = process.argv.slice(2)) {
  const startedAt = 0
  if (argv[0] === '--worker') return worker(JSON.parse(Buffer.from(argv[1], 'base64url')))
  const mode = argv.shift()
  if (!['--plan', '--run'].includes(mode)) throw new Error('choose --plan or --run')
  const args = {}
  while (argv.length) {
    const key = argv.shift()
    if (!['--manifest', '--output', '--plan', '--plan-sha256', '--storage'].includes(key) || !argv.length || args[key]) throw new Error('invalid/duplicate CLI option')
    args[key] = argv.shift()
  }
  if (!args['--output']) throw new Error('private --output required')
  const output = canonicalFreshArtifactPath(args['--output'], repo)
  if (mode === '--plan') {
    if (!args['--manifest']) throw new Error('--manifest required')
    const manifestPath = realpathSync(args['--manifest'])
    const bytes = readFileSync(manifestPath)
    validateOwnershipManifest(JSON.parse(bytes))
    const plan = { schema: CPU_PROTOCOL.schema, protocol: CPU_PROTOCOL, schedule: referenceCpuSchedule(),
      identity: referenceCpuIdentity(repo), manifest: { path: manifestPath, sha256: sha256(bytes) },
      externalGuard: 'required separate 65s process guard; external termination is incomplete',
      interpretation: 'reference diagnostic only; sample counts and interval estimates are not exact CPU shares' }
    writeFresh(output, plan)
    return
  }
  if (!args['--plan'] || !args['--plan-sha256'] || !args['--storage']) throw new Error('--plan, --plan-sha256 and --storage required')
  const planPath = realpathSync(args['--plan'])
  const plan = readPinnedPlan(planPath, args['--plan-sha256'])
  same(plan.protocol, CPU_PROTOCOL, 'protocol')
  same(plan.schedule, referenceCpuSchedule(), 'schedule')
  const storage = realpathSync(args['--storage'])
  if (!statSync(storage).isDirectory()) throw new Error('storage must be an existing directory')
  const within = relative(realpathSync(repo), storage)
  if (!isAbsolute(within) && (within === '' || (within !== '..' && !within.startsWith(`..${sep}`)))) throw new Error('storage must be outside repository')
  const paths = plan.schedule.map((row, index) => ({ artifactPath: canonicalFreshArtifactPath(join(storage, `${index + 1}.cpuprofile`), repo),
    receiptPath: canonicalFreshArtifactPath(join(storage, `${index + 1}.receipt.json`), repo), row, index, planPath, planSha256: args['--plan-sha256'] }))
  let ownsOutput = false
  const report = await runReferenceCpuCampaign({ plan: { sha256: args['--plan-sha256'] }, startedAt, now: () => performance.now(),
    prepare() {
      same(referenceCpuIdentity(repo), plan.identity, 'launch physical identity')
      manifestAt(plan)
    },
    persist(value) {
      if (!ownsOutput) { writeFresh(output, value); ownsOutput = true; return }
      const temporary = `${output}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, output)
    },
    launch(row, timeout) {
      const config = paths.find(item => item.row.id === row.id)
      return spawnSync(process.execPath, [script, '--worker', Buffer.from(JSON.stringify(config)).toString('base64url')],
        { timeout, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } })
    },
    validate(child, row) {
      const config = paths.find(item => item.row.id === row.id)
      const receiptBytes = readFileSync(config.receiptPath)
      const envelope = JSON.parse(child.stdout)
      if (envelope.receiptSha256 !== sha256(receiptBytes)) throw new Error('child receipt checksum mismatch')
      const receipt = JSON.parse(receiptBytes)
      if (receipt.id !== row.id || receipt.planSha256 !== args['--plan-sha256'] || receipt.manifestSha256 !== plan.manifest.sha256
        || receipt.identitySha256 !== sha256(JSON.stringify(plan.identity))) throw new Error('child receipt identity mismatch')
      const fixture = plan.identity.fixtures.find(item => item.id === row.fixture)
      same(receipt.protocol, CPU_PROTOCOL, 'receipt protocol')
      if (receipt.warmups !== 3 || receipt.iterations !== 1000 || receipt.sampleIntervalUs !== 1000) throw new Error('receipt iteration/sampling count changed')
      same(receipt.physicalInputs, redactPrivatePaths(plan.identity), 'receipt physical inputs')
      if (receipt.inputSha256 !== fixture.sha256) throw new Error('child input mismatch')
      const artifact = readFileSync(config.artifactPath)
      if (artifact.length !== receipt.artifactBytes || sha256(artifact) !== receipt.artifactSha256) throw new Error('artifact mismatch')
      if (receipt.status === 'incomplete') return { ...receipt, receiptSha256: envelope.receiptSha256, adequate: false }
      if (receipt.documentCount !== fixture.expectedDocuments || receipt.policy?.verified !== true) throw new Error('child graph/policy mismatch')
      const clock = receipt.clocks
      if (!clock || clock.valid !== true || !/^\d+$/.test(clock.loopWallNs) || ![clock.processUserUs, clock.processSystemUs].every(value => Number.isFinite(value) && value >= 0)) throw new Error('invalid loop clock receipt')
      const profileClock = JSON.parse(artifact)
      same(clock.inspector, { startTime: profileClock.startTime, endTime: profileClock.endTime, deltaUs: profileClock.endTime - profileClock.startTime }, 'Inspector receipt clock')
      same(clock.snapshotOrder, ['hrtime-start', 'cpuUsage-start', 'batch', 'cpuUsage-end', 'hrtime-end'], 'clock snapshot order')
      const audited = redactPrivatePaths(auditOwnedCpuProfile(artifact, receipt.artifactSha256, manifestAt(plan)))
      same(audited, receipt.audit, 'independent profile audit')
      same(referenceCpuIdentity(repo), plan.identity, 'post-child physical identity')
      return { ...receipt, receiptSha256: envelope.receiptSha256,
        adequate: receipt.status === 'completed' && receipt.completedOperations === 1000 && audited.adequate }
    } })
  if (report.status !== 'completed') process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
