import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SERVER_ENTRY, SERVER_TAGS_ENTRY, gitProvenance, hashFile, hashModuleClosure, packageProvenance, sha256 } from './lsp-contract.mjs'
import { loadPinnedCorpus } from './lsp-fixtures.mjs'

export const REFERENCE_ENTRY = '/tmp/ly-owner-lsp-feasibility-nov16/node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js'
export const SERVER_ROOT = '/tmp/ly-nov13-lsp-candidate'
export const SERVER_HEAD = '4bf9c818850bf9751696d24848fdeaececb4203c'

export function referenceCpuIdentity(repoRoot) {
  const harness = gitProvenance(repoRoot)
  const server = gitProvenance(SERVER_ROOT)
  if (harness.dirty || server.dirty || server.head !== SERVER_HEAD) throw new Error('dirty or changed harness/server identity')
  if (realpathSync(REFERENCE_ENTRY) !== REFERENCE_ENTRY) throw new Error('reference must be physical pinned stock yaml')
  const provider = packageProvenance(REFERENCE_ENTRY, 'yaml')
  if (provider.version !== '2.9.0' || provider.packageJsonSha256 !== '20b8b197cbd10dad245d45e463dfe58e4c8c25a47e24bc4256ad9ab58bf35683'
    || provider.entry.sha256 !== '2d58984e0ae80de4acbd8f009fab332f5ce77d9e1a5f138a3058a0ada6567fb9'
    || provider.closure.count !== 72 || provider.closure.sha256 !== '2dd772e1e6839d90159c0fa900247b2d9854766c4d17f8953eb704110c03b217') throw new Error('physical stock yaml identity changed')
  const compiled = hashModuleClosure(join(SERVER_ROOT, SERVER_ENTRY))
  if (compiled.count !== 23 || compiled.sha256 !== 'd80b96a9ee4e9c769e9c0398d0985ece1d4151a6b982f7e4005eef4244df7149'
    || hashFile(join(SERVER_ROOT, SERVER_TAGS_ENTRY)).sha256 !== '976de3bcffd4b08dd4774011fce0a7fef0d60ab9610a7a91c621de83ae40d8ca') throw new Error('compiled server identity changed')
  const expectedAlias = { 'package.json': '084806d1af24aba980e560c51e93ff7e3c9aaa7b64655aed8085eff403cb508a',
    'index.js': 'bfa95ecb0c617470ddc2e7302ecec2ea6a44ca6b2b9dfb8f061d9d4f30eca6cc',
    'index.d.ts': 'bfa95ecb0c617470ddc2e7302ecec2ea6a44ca6b2b9dfb8f061d9d4f30eca6cc' }
  const alias = Object.entries(expectedAlias).map(([file, digest]) => {
    const actual = hashFile(join(SERVER_ROOT, 'node_modules/yaml', file))
    if (actual.sha256 !== digest) throw new Error('installed server alias changed')
    return actual
  })
  const runtime = { version: process.version, v8: process.versions.v8, arch: process.arch, executable: hashFile(realpathSync(process.execPath)), execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? '' }
  if (runtime.version !== 'v24.19.0' || runtime.executable.sha256 !== 'a4c7d261ae62215e73edd637711f09a545535226ae9932c3148342f0b027d56b'
    || runtime.nodeOptions !== '' || runtime.execArgv.length !== 0) throw new Error('CPU runtime identity changed')
  const externalPins = JSON.parse(readFileSync(new URL('./lsp-reference-cpu-external-pins.json', import.meta.url)))
  const external = externalPins.pinnedFiles.map(pin => {
    const actual = hashFile(pin.path)
    if (actual.bytes !== pin.bytes || actual.sha256 !== pin.sha256) throw new Error('external server dependency identity changed')
    return actual
  })
  const fixtures = loadPinnedCorpus(repoRoot).map(({ source, ...pin }) => pin)
  return { harness, harnessClosure: hashModuleClosure(resolve(repoRoot, 'scripts/compatibility/bench-lsp-reference-cpu.mjs')),
    server, provider, compiled, alias, external, runtime, fixtures,
    closureDigestPolicy: 'sha256(JSON.stringify(sorted absolute-path/SHA256 pairs)); hashModuleClosure v1',
    corpusManifest: hashFile(resolve(repoRoot, 'test/corpus/real-world/manifest.json')),
    lock: hashFile(resolve(repoRoot, 'pnpm-lock.yaml')) }
}

export function readPinnedPlan(file, expectedSha256) {
  const bytes = readFileSync(file)
  if (sha256(bytes) !== expectedSha256) throw new Error('launch plan checksum mismatch')
  return JSON.parse(bytes)
}
