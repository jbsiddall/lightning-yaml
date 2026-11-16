import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const selectedPins = {
  'docker-compose-pihole-cloudflared-doh': {
    localPath: 'test/corpus/real-world/compose-pihole-cloudflared.yaml',
    bytes: 1608,
    documents: 1,
    sha256: '1d21b87c152f756a760df9029fe1d303d3c2fad00b4ca277439490ac77e7a857',
    repository: 'docker/awesome-compose',
    commit: '30f4b7f6a6c3b0c0ecf4d4efb0de203c48d11562',
    sourcePath: 'pihole-cloudflared-DoH/compose.yaml',
    license: 'CC0-1.0',
    licensePath: 'test/corpus/real-world/licenses/awesome-compose-LICENSE.txt',
    licenseSourcePath: 'LICENSE',
    licenseBytes: 7048,
    licenseSha256: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499'
  },
  'kubernetes-zookeeper': {
    localPath: 'test/corpus/real-world/kubernetes-zookeeper.yaml',
    bytes: 2903,
    documents: 4,
    sha256: 'f8ee35065a386477e8435a64cecc2a5fd9e89e708666426be8d8760e7efdd529',
    repository: 'kubernetes/website',
    commit: '109572ac97242c9b3d68b4b26afdd22b5f88ed73',
    sourcePath: 'content/en/examples/application/zookeeper/zookeeper.yaml',
    license: 'CC-BY-4.0',
    licensePath: 'test/corpus/real-world/licenses/kubernetes-website-LICENSE.txt',
    licenseSourcePath: 'LICENSE',
    licenseBytes: 18657,
    licenseSha256: '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411'
  },
  'github-actions-cmake-multi-platform': {
    localPath: 'test/corpus/real-world/github-actions-cmake-multi-platform.yml',
    bytes: 3356,
    documents: 1,
    sha256: '251f58c701753102802d0cb9a45f217d68ee1599475dcce1114641f3b42eacc0',
    repository: 'actions/starter-workflows',
    commit: 'e3c451d60f119b71caebf13c98ac45da6e15b4b7',
    sourcePath: 'ci/cmake-multi-platform.yml',
    license: 'MIT',
    licensePath: 'test/corpus/real-world/licenses/starter-workflows-LICENSE.txt',
    licenseSourcePath: 'LICENSE',
    licenseBytes: 1154,
    licenseSha256: 'd78930d559f68ee1b8d5c69df99c42a223921b1953e9bb59d7ef1785acb81fb3'
  }
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function loadPinnedCorpus(repoRoot) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'test/corpus/real-world/manifest.json'), 'utf8'))
  const aggregate = sha256(JSON.stringify(manifest.inputs.map(({ localPath, sha256: digest }) => [localPath, digest])))
  if (aggregate !== 'e54699066923f95316d5edcec1bb486bff4adb48bb67c022d9087c9d34f68a9d' || aggregate !== manifest.aggregateSha256) {
    throw new Error('real-world corpus manifest aggregate hash changed')
  }
  const entries = []
  for (const [id, pin] of Object.entries(selectedPins)) {
    const sourceEntry = manifest.inputs.find((entry) => entry.id === id)
    if (!sourceEntry) throw new Error(`fixture manifest is missing ${id}`)
    for (const key of ['localPath', 'bytes', 'sha256', 'license', 'licensePath', 'licenseSha256', 'repository', 'commit', 'sourcePath', 'licenseBytes', 'licenseSourcePath']) {
      if (key in pin && sourceEntry[key] !== pin[key]) throw new Error(`${id}: pinned ${key} changed`)
    }
    const sourceUrl = `https://github.com/${pin.repository}/blob/${pin.commit}/${pin.sourcePath}`
    const licenseUrl = `https://github.com/${pin.repository}/blob/${pin.commit}/${pin.licenseSourcePath}`
    if (sourceEntry.sourceUrl !== sourceUrl || sourceEntry.licenseUrl !== licenseUrl) throw new Error(`${id}: source/license URL is not immutable`)
    const file = resolve(repoRoot, pin.localPath)
    const bytes = readFileSync(file)
    if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`${id}: source bytes do not match the P0a pin`)
    const license = readFileSync(resolve(repoRoot, pin.licensePath))
    if (license.length !== pin.licenseBytes || sha256(license) !== pin.licenseSha256) {
      throw new Error(`${id}: license bytes do not match the corpus manifest`)
    }
    entries.push({
      id,
      sourcePath: sourceEntry.sourcePath,
      sourceUrl: sourceEntry.sourceUrl,
      repository: sourceEntry.repository,
      commit: sourceEntry.commit,
      localPath: pin.localPath,
      license: sourceEntry.license,
      licensePath: sourceEntry.licensePath,
      licenseSha256: sourceEntry.licenseSha256,
      bytes: bytes.length,
      utf16Length: bytes.toString('utf8').length,
      sha256: sha256(bytes),
      expectedDocuments: pin.documents,
      source: bytes.toString('utf8')
    })
  }
  return entries
}

export function expandDocumentStream(fixture, copies) {
  if (!Number.isSafeInteger(copies) || copies < 1 || copies > 1000) throw new Error('copies must be an integer from 1 through 1000')
  const separator = '\n---\n'
  const source = Array(copies).fill(fixture.source).join(separator)
  return {
    id: `${fixture.id}:scaled-document-count:${copies}`,
    transform: 'repeat complete source documents separated by LF + --- + LF',
    sourceId: fixture.id,
    sourceSha256: fixture.sha256,
    repeatCount: copies,
    separator,
    separatorUtf8Bytes: Buffer.byteLength(separator),
    bytes: Buffer.byteLength(source),
    utf16Length: source.length,
    sha256: sha256(source),
    source
  }
}

export const semanticSources = Object.freeze({
  crlfEmoji: 'head: "😀"\r\nitems:\r\n  - one\r\n',
  callbackNonemptyFinalLine: 'head: 😀\r\nitems:\r\n  - one\r\nlast: yes',
  callbackEmptyFinalLine: 'head: 😀\r\nitems:\r\n  - one\r\n\r\n',
  callbackWhitespaceFinalLine: 'head: 😀\r\nitems:\r\n  - one\r\n  \r\n',
  customTags: '# head\n---\ninclude: !include value.yaml\nscalar: !count 12\nobject: !record {name: hi}\n',
  includeMissing: 'include: !include\n',
  aliases: 'anchor: &a {k: [x, y]}\ncopy: *a\n',
  recovery: 'ok: 1\n---\nitems: [\n---\nlast: 2\n',
  recoveryInline: 'items: [a,\nnext: 1\n',
  duplicateKeys: 'a: 1\na: 2\n',
  comparatorKeys: 'A: 1\na: 2\n',
  rootIndent: '|2\n  hello\n'
})

export const plannedBatches = Object.freeze({
  'bare-corpus': Object.freeze({ providers: ['reference', 'candidate'], fixtures: ['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform'], policies: ['literal-default'] }),
  'bare-scale': Object.freeze({ providers: ['reference', 'candidate'], fixtures: ['github-actions-cmake-multi-platform:scaled-document-count:30', 'github-actions-cmake-multi-platform:scaled-document-count:312'], policies: ['literal-default'] }),
  'bare-policy': Object.freeze({ providers: ['reference', 'candidate'], fixtures: ['duplicateKeys', 'comparatorKeys'], policies: ['uniqueKeys-false', 'uniqueKeys-true', 'uniqueKeys-comparator'] }),
  'lsp-consumer': Object.freeze({ providers: ['reference', 'candidate'], fixtures: ['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform'], documentModes: ['absent', 'nonempty-final-line', 'empty-final-line', 'whitespace-final-line'], policies: ['literal-default'] })
})

export function enumerateCells(batchName) {
  const batch = plannedBatches[batchName]
  if (!batch) throw new Error(`unknown planned batch ${batchName}`)
  const cells = []
  for (const provider of batch.providers) {
    for (const fixture of batch.fixtures) {
      for (const policy of batch.policies) {
        for (const documentMode of batch.documentModes ?? ['absent']) {
          const id = [batchName, provider, fixture, policy, documentMode].join(':')
          cells.push({ id, batch: batchName, provider, fixture, policy, documentMode })
        }
      }
    }
  }
  return cells
}
