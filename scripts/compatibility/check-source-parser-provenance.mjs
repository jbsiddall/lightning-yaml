import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/source-parser-provenance.json'), 'utf8'))
if (manifest.upstream.version !== '2.9.0' || manifest.upstream.commit !== 'ddb21b04cb889722cec8f89dc1b67f19d62d7f7d') {
  throw new Error('Unexpected yaml source provenance pin')
}

let checkedHashes = 0
for (const entry of manifest.files) {
  if (!/^[a-f\d]{64}$/i.test(entry.sha256)) throw new Error(`Invalid upstream SHA256 for ${entry.upstreamPath}`)
  const localPath = resolve(root, entry.localPath)
  if (!statSync(localPath).isFile()) throw new Error(`Missing local source port: ${entry.localPath}`)
  const source = readFileSync(localPath)
  if (!source.includes(Buffer.from('Copyright Eemeli Aro')) || !source.includes(Buffer.from('Permission to use, copy, modify'))) {
    throw new Error(`Missing retained ISC notice: ${entry.localPath}`)
  }
  if (entry.localSha256) {
    const actual = createHash('sha256').update(source).digest('hex')
    if (actual !== entry.localSha256) throw new Error(`Local source hash mismatch for ${entry.localPath}: ${actual}`)
    checkedHashes++
  }
}

if (manifest.distributionNotice !== 'THIRD_PARTY_NOTICES' || !statSync(resolve(root, manifest.distributionNotice)).isFile()) {
  throw new Error('Missing third-party distribution notice reference or file')
}
console.log(`Source provenance valid: ${manifest.files.length} records, ${checkedHashes} local SHA256 checks, yaml ${manifest.upstream.version} (${manifest.upstream.commit})`)
