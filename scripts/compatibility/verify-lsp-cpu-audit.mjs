import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { auditCpuProfile, readHashBoundJson } from './lsp-cpu-audit.mjs'

export function verifyFrozenCpuAudit(directory, manifest) {
  if (manifest.schema !== 'lsp-frozen-cpu-audit-v1'
    || !isDeepStrictEqual(manifest.records.map((record) => record.participant), ['candidate', 'reference', 'server-candidate', 'server-reference'])) throw new Error('frozen audit record set')
  const ledger = readHashBoundJson(readFileSync(resolve(directory, 'diagnostic-ledger.json')), manifest.ledgerSha256)
  readHashBoundJson(readFileSync(resolve(directory, 'declared-run-plan.json')), manifest.declaredPlanSha256)
  if (ledger.status !== 'completed' || ledger.scored !== false) throw new Error('ledger status')
  for (const record of manifest.records) {
    const row = ledger.rows.find((row) => row.prefix === record.prefix)
    if (!row || row.status !== 'completed' || row.exitCode !== 0 || row.jsonSha256 !== record.receiptSha256) throw new Error('ledger receipt mismatch')
    const receipt = readHashBoundJson(readFileSync(resolve(directory, `${record.prefix}.json`)), record.receiptSha256)
    if (receipt.status !== 'completed' || receipt.scoredMeasurement !== false || receipt.participant !== record.participant
      || receipt.artifact.sha256 !== record.audit.artifactSha256 || receipt.artifact.bytes !== record.artifactBytes
      || readFileSync(resolve(directory, `${record.prefix}.exit`), 'utf8').trim() !== '0') throw new Error('receipt identity/status mismatch')
    const scoped = (obj) => Object.fromEntries(Object.entries(obj).filter(([key]) => !['path', 'root', 'entryPath', 'files'].includes(key)))
    const artifacts = (obj) => Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, scoped(value)]))
    const identities = { policy: receipt.policy, fixture: receipt.fixture,
      candidate: { head: receipt.candidate.head, artifacts: artifacts(receipt.candidate.artifacts) },
      server: { head: receipt.server.head, artifacts: artifacts(receipt.server.artifacts) },
      reference: scoped(receipt.reference), harness: receipt.harness,
      provider: { ...scoped(receipt.worker.provider), entry: scoped(receipt.worker.provider.entry), closure: scoped(receipt.worker.provider.closure) },
      warmups: receipt.worker.diagnosticResult.warmups, iterations: receipt.worker.diagnosticResult.iterations,
      sampleIntervalUs: receipt.worker.diagnosticResult.sampleIntervalUs }
    for (const [key, value] of Object.entries(identities)) {
      if (!isDeepStrictEqual(record[key], value)) throw new Error(`static receipt identity mismatch: ${key}`)
    }
    const bytes = readFileSync(resolve(directory, `${record.prefix}.cpuprofile`))
    if (bytes.length !== record.artifactBytes) throw new Error('profile byte length mismatch')
    const witnesses = record.audit.witnesses.map(({ label, frames }) => ({ label, frames }))
    const audit = auditCpuProfile(bytes, record.audit.artifactSha256, witnesses)
    if (!isDeepStrictEqual(audit, record.audit)) throw new Error('static audit mismatch')
    for (const key of ['sampleCount', 'assignedSamples', 'usefulSamples', 'classifiedCoverage', 'categories', 'attributionAssessment']) {
      if (!isDeepStrictEqual(audit.legacy[key], receipt.worker.diagnosticResult[key])) throw new Error(`historical classifier mismatch: ${key}`)
    }
  }
  return manifest.records.map(({ participant, audit }) => ({ participant, samples: audit.sampleCount }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('usage: node scripts/compatibility/verify-lsp-cpu-audit.mjs PRIVATE_DIRECTORY')
  const manifest = JSON.parse(readFileSync(new URL('../../docs/compatibility/reports/2026-11-18/lsp-cpu-audit.json', import.meta.url), 'utf8'))
  console.log(JSON.stringify(verifyFrozenCpuAudit(process.argv[2], manifest)))
}
