import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

export const SERVER_ENTRY = 'out/src/languageservice/parser/yamlParser07.js'
export const SERVER_TAGS_ENTRY = 'out/src/languageservice/parser/custom-tag-provider.js'

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function hashFile(file) {
  const bytes = readFileSync(file)
  return { path: resolve(file), bytes: bytes.length, sha256: sha256(bytes) }
}

export function findPackageRoot(file, expectedName) {
  let dir = dirname(resolve(file))
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (!expectedName || pkg.name === expectedName) return { root: dir, package: pkg }
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`could not locate package ${expectedName ?? ''} for ${file}`)
    dir = parent
  }
}

export function hashModuleClosure(entry) {
  const pending = [resolve(entry)]
  const seen = new Set()
  const files = []
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const bytes = readFileSync(file)
    files.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) })
    if (extname(file) !== '.js' && extname(file) !== '.mjs' && extname(file) !== '.cjs') continue
    const text = bytes.toString('utf8')
    const specifiers = [
      ...[...text.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)].map((match) => match[1]),
      ...[...text.matchAll(/\brequire\(['"](\.[^'"]+)['"]\)/g)].map((match) => match[1])
    ]
    for (const specifier of specifiers) {
      const base = resolve(dirname(file), specifier)
      const candidates = [base, ...['.js', '.mjs', '.cjs', '.json'].map((extension) => `${base}${extension}`), ...['index.js', 'index.mjs', 'index.cjs'].map((name) => join(base, name))]
      for (const imported of candidates) {
        try {
          if (statSync(imported).isFile()) { pending.push(imported); break }
        } catch {}
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const digest = sha256(JSON.stringify(files.map(({ path, sha256: hash }) => [path, hash])))
  return { count: files.length, sha256: digest, files }
}

export function gitProvenance(root) {
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  return { root: resolve(root), head: run('rev-parse', 'HEAD'), tree: run('rev-parse', 'HEAD^{tree}'), dirty: run('status', '--porcelain') !== '' }
}

export function packageProvenance(entry, expectedName) {
  const { root, package: pkg } = findPackageRoot(entry, expectedName)
  const lock = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'].map((name) => join(root, name)).find((file) => {
    try { return statSync(file).isFile() } catch { return false }
  })
  return {
    root,
    name: pkg.name,
    version: pkg.version,
    packageJsonSha256: hashFile(join(root, 'package.json')).sha256,
    lock: lock ? hashFile(lock) : null,
    entry: hashFile(entry),
    closure: hashModuleClosure(entry)
  }
}

export async function importYamlProvider(entry) {
  const absolute = resolve(entry)
  const namespace = await import(pathToFileURL(absolute).href)
  const api = namespace.default && typeof namespace.default === 'object'
    ? { ...namespace.default, ...namespace }
    : namespace
  const provenance = packageProvenance(absolute, undefined)
  return { api, provenance, entryUrl: pathToFileURL(absolute).href }
}

export function assertYamlProvider(api, label = 'provider') {
  const missing = ['Parser', 'Composer', 'LineCounter', 'Document', 'CST'].filter((name) => !api[name])
  if (missing.length) {
    const detail = missing.includes('Composer') || missing.includes('Document')
      ? 'Composer/Document support absent'
      : `missing API: ${missing.join(', ')}`
    throw new Error(`${label}: ${detail}`)
  }
  for (const name of ['Parser', 'Composer', 'LineCounter']) {
    if (typeof api[name] !== 'function') throw new Error(`${label}: ${name} is not constructible`)
  }
  if (typeof api.CST.stringify !== 'function') throw new Error(`${label}: CST.stringify is missing`)
  if (typeof api.CST.resolveAsScalar !== 'function') throw new Error(`${label}: CST.resolveAsScalar is missing`)
}

export function resolveUniqueKeys(policy, trace) {
  if (policy === 'literal-default') return { name: policy, value: undefined }
  if (policy === 'uniqueKeys-false') return { name: policy, value: false }
  if (policy === 'uniqueKeys-true') return { name: policy, value: true }
  if (policy === 'uniqueKeys-comparator') {
    if (!Array.isArray(trace)) throw new TypeError('comparator policy requires a trace array')
    return {
      name: policy,
      value: (left, right) => {
        trace.push({ left: left.value, right: right.value })
        return String(left.value).toLowerCase() === String(right.value).toLowerCase()
      }
    }
  }
  throw new Error(`unknown uniqueKeys policy ${policy}`)
}

export function runBareOperation(api, source, { customTags = [], customTagsFactory, policy = 'literal-default', captureLineCallbacks = false, document = null } = {}) {
  const lineCounter = new api.LineCounter()
  const callbacks = captureLineCallbacks ? [] : null
  const callback = captureLineCallbacks
    ? (offset) => { callbacks.push(offset); lineCounter.addNewLine(offset) }
    : lineCounter.addNewLine
  const finalLineEmpty = document !== null && (source.split(/\r\n|\n|\r/).at(-1) ?? '').trim().length === 0
  const parser = finalLineEmpty ? new api.Parser() : new api.Parser(callback)
  const uniqueKeysTrace = policy === 'uniqueKeys-comparator' ? [] : null
  const uniqueKeys = resolveUniqueKeys(policy, uniqueKeysTrace)
  const actualCustomTags = customTagsFactory ? customTagsFactory() : customTags
  const composerOptions = {
    strict: false,
    version: '1.2',
    keepSourceTokens: true,
    customTags: actualCustomTags
  }
  if (uniqueKeys.value !== undefined) composerOptions.uniqueKeys = uniqueKeys.value
  const composer = new api.Composer(composerOptions)
  const tokens = Array.from(parser.parse(source))
  const documents = Array.from(composer.compose(tokens, true, source.length))
  const result = { tokens, documents, lineCounter }
  if (captureLineCallbacks) result.callbacks = callbacks
  if (uniqueKeysTrace) result.uniqueKeysTrace = uniqueKeysTrace
  if (document !== null) result.finalLineEmpty = finalLineEmpty
  return result
}

export function tokenGraphContains(root, target) {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const value = stack.pop()
    if (value === target) return true
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    for (const key of Object.keys(value)) stack.push(value[key])
  }
  return false
}

export function reconstructCst(api, tokens) {
  return tokens.map((token) => api.CST.stringify(token)).join('')
}

export function assertCstLossless(api, tokens, source) {
  const rebuilt = reconstructCst(api, tokens)
  if (rebuilt !== source) throw new Error(`CST lost or changed source bytes (${rebuilt.length} != ${source.length})`)
  return { utf16Length: source.length, utf8Bytes: Buffer.byteLength(source), sha256: sha256(source) }
}

export function sourceLineStarts(source) {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) {
    const char = source.charCodeAt(i)
    if (char === 13 && source.charCodeAt(i + 1) === 10) { offsets.push(i + 2); i++ }
    else if (char === 13 || char === 10) offsets.push(i + 1)
  }
  return offsets
}

export function assertProviderDocument(api, document, tokens) {
  if (!api.isDocument?.(document) || !(document instanceof api.Document)) throw new Error('document has the wrong provider brand')
  const nodeTypes = [
    ['Scalar', api.isScalar], ['Pair', api.isPair], ['Map', api.isMap], ['Seq', api.isSeq], ['Alias', api.isAlias]
  ]
  const seen = new Set()
  const stack = [document.contents]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (!nodeTypes.some(([, predicate]) => predicate?.(node))) throw new Error('document graph contains an unbranded node')
    if (node.srcToken && !tokenGraphContains(tokens, node.srcToken)) throw new Error('AST srcToken is not identical to a Parser-produced token')
    if (api.isMap?.(node) || api.isSeq?.(node)) {
      if (!Array.isArray(node.items) || Object.getPrototypeOf(node.items) !== Array.prototype || !Object.isExtensible(node.items)) {
        throw new Error('collection items are not ordinary mutable arrays')
      }
      for (const item of node.items) stack.push(item)
    }
    if (api.isPair?.(node)) { stack.push(node.key, node.value) }
    if (api.isAlias?.(node)) {
      const anchor = node.resolve(document)
      if (!anchor || !tokenGraphContains(tokens, anchor.srcToken)) throw new Error('alias did not resolve to the anchored provider node')
    }
  }
  return { documentBrand: true, graphNodes: seen.size, arrayItems: true, tokenIdentity: true }
}

export function assertRootScalarValue(api, document, tokens, expected) {
  const scalar = document?.contents
  if (!api.isScalar?.(scalar) || scalar.value !== expected) {
    throw new Error(`root scalar value changed: ${JSON.stringify(scalar?.value)} != ${JSON.stringify(expected)}`)
  }
  if (!scalar.srcToken || !tokenGraphContains(tokens, scalar.srcToken)) {
    throw new Error('root scalar source token is not identical to a Parser-produced token')
  }
  return { value: scalar.value, tokenIdentity: true }
}

export function assertLineStarts(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('line callback offsets changed')
}

export function assertDiagnosticPosition(document, code, expectedPosition) {
  const diagnostic = document?.errors?.find((item) => item.code === code)
  if (!diagnostic || JSON.stringify(diagnostic.pos) !== JSON.stringify(expectedPosition)) {
    throw new Error(`${code} diagnostic position changed`)
  }
  return diagnostic
}

export function assertCustomTagReturnType(node, expected) {
  if (node?.customTagReturnType !== expected) throw new Error(`custom tag return type changed: expected ${expected}`)
}

export function assertAliasResolvesTo(api, document, tokens, anchorNode) {
  const seen = new Set()
  const stack = [document?.contents]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (api.isAlias?.(node)) {
      if (node.resolve(document) !== anchorNode) throw new Error('alias did not resolve to the exact anchored node')
      if (!anchorNode?.srcToken || !tokenGraphContains(tokens, anchorNode.srcToken)) throw new Error('alias anchor token is detached from Parser tokens')
      return node
    }
    if (api.isMap?.(node)) stack.push(...node.items)
    if (api.isSeq?.(node)) stack.push(...node.items)
    if (api.isPair?.(node)) stack.push(node.key, node.value)
  }
  throw new Error('document has no alias node')
}

export function graphSnapshot(root, api) {
  const ids = new Map()
  const records = []
  const queue = []
  const ref = (value) => {
    if (!value || typeof value !== 'object') return value
    if (!ids.has(value)) { ids.set(value, ids.size); queue.push(value) }
    return { ref: ids.get(value) }
  }
  const rootRef = ref(root)
  while (queue.length) {
    const value = queue.shift()
    const id = ids.get(value)
    const kind = api.isDocument?.(value) ? 'Document'
      : api.isScalar?.(value) ? 'Scalar'
        : api.isPair?.(value) ? 'Pair'
          : api.isMap?.(value) ? 'Map'
            : api.isSeq?.(value) ? 'Seq'
              : api.isAlias?.(value) ? 'Alias'
                : Array.isArray(value) ? 'Array'
                  : value instanceof Map ? 'MapObject'
                    : value instanceof Set ? 'SetObject' : 'Object'
    const fields = {}
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value === 'function') continue
      fields[key] = ref(descriptor.value)
    }
    records.push({ id, kind, fields })
  }
  return { root: rootRef, records }
}

export function assertUtf16RecoveryVector(api) {
  const source = 'x: "😀"\r\nbad: [1,\r\n'
  const result = runBareOperation(api, source)
  const doc = result.documents[0]
  const error = doc?.errors.find((item) => item.code === 'BAD_INDENT')
  if (!error || error.pos[0] !== 19 || error.pos[1] !== 20) throw new Error('UTF-16 CRLF diagnostic did not remain at [19,20]')
  if (source.length !== 19 || [...source].length !== 18) throw new Error('UTF-16 witness bytes changed')
  return { source, position: [...error.pos], documentCount: result.documents.length }
}

export function validateWorkerEnvelope(stdout, { workerId, expectedHead, cellIds, expectedInputSha256 = {} }) {
  let value
  try { value = JSON.parse(stdout) } catch (error) { throw new Error(`worker ${workerId} returned invalid JSON: ${error.message}`) }
  if (value.workerId !== workerId) throw new Error(`worker ID mismatch: expected ${workerId}, got ${value.workerId}`)
  if (value.head !== expectedHead) throw new Error(`worker ${workerId} reported an unexpected HEAD`)
  if (!Array.isArray(value.cells)) throw new Error(`worker ${workerId} omitted cell records`)
  const seen = new Set()
  for (const cell of value.cells) {
    if (!cellIds.includes(cell.id)) throw new Error(`worker returned unknown cell ${cell.id}`)
    if (seen.has(cell.id)) throw new Error(`worker returned duplicate cell ${cell.id}`)
    seen.add(cell.id)
    if (!/^[a-f0-9]{64}$/.test(cell.inputSha256) || !/^[a-f0-9]{64}$/.test(cell.outputSha256)) {
      throw new Error(`worker cell ${cell.id} omitted valid SHA-256 checksums`)
    }
    if (expectedInputSha256[cell.id] && cell.inputSha256 !== expectedInputSha256[cell.id]) {
      throw new Error(`worker cell ${cell.id} reported a different input checksum`)
    }
  }
  for (const id of cellIds) if (!seen.has(id)) throw new Error(`worker ${workerId} omitted planned cell ${id}`)
  return value
}

export function finalizeCellLedger(plannedIds, results) {
  const seen = new Set()
  for (const result of results) {
    if (!plannedIds.includes(result.id)) throw new Error(`unknown cell status ${result.id}`)
    if (seen.has(result.id)) throw new Error(`duplicate cell status ${result.id}`)
    if (!['completed', 'failed'].includes(result.status)) throw new Error(`invalid cell status ${result.status}`)
    seen.add(result.id)
  }
  return {
    planned: [...plannedIds],
    completed: results.filter((cell) => cell.status === 'completed').map((cell) => cell.id),
    failed: results.filter((cell) => cell.status === 'failed').map((cell) => cell.id),
    pending: plannedIds.filter((id) => !seen.has(id))
  }
}

export async function getRegisterHooks(capabilityLoader = () => import('node:module')) {
  const module = await capabilityLoader()
  return typeof module.registerHooks === 'function' ? module.registerHooks : null
}

export function createYamlResolverHook(providerEntry, resolutions) {
  const target = pathToFileURL(resolve(providerEntry)).href
  return {
    resolve(specifier, context, nextResolve) {
      if (specifier === 'yaml') {
        resolutions.push({ specifier, parentURL: context.parentURL ?? null, target })
        return { url: target, shortCircuit: true }
      }
      if (specifier.startsWith('yaml/')) throw new Error(`unexpected yaml subpath import ${specifier}`)
      return nextResolve(specifier, context)
    }
  }
}

export function assertYamlResolutions(resolutions, providerEntry, serverRoot) {
  const expected = pathToFileURL(resolve(providerEntry)).href
  if (resolutions.length === 0) throw new Error('actual server performed no mapped bare yaml imports')
  for (const item of resolutions) {
    if (item.specifier !== 'yaml' || item.target !== expected) throw new Error('server yaml import escaped its explicit provider mapping')
    if (serverRoot && !fileURLToPath(item.parentURL ?? '').startsWith(`${resolve(serverRoot)}/`)) {
      throw new Error(`yaml import parent escaped the compiled server root: ${item.parentURL}`)
    }
  }
  return resolutions
}

export function createRequireForPackage(packageFile) {
  return createRequire(resolve(packageFile))
}

export function enumerateErrorSignature(documents) {
  return documents.flatMap((document) => document.errors.map((error) => ({
    code: error.code,
    pos: [...error.pos],
    message: error.message
  })))
}

export function assertDuplicateKeyFixturePolicy(document, expectedUniqueKeys) {
  if (typeof expectedUniqueKeys !== 'boolean') throw new TypeError('expected duplicate-key policy must be boolean')
  const uniqueKeys = document?.options?.uniqueKeys
  if (uniqueKeys !== expectedUniqueKeys) throw new Error(`duplicate-key policy changed: expected ${expectedUniqueKeys}, got ${uniqueKeys}`)

  // The value and span below are specific to semanticSources.duplicateKeys.
  const diagnostics = enumerateErrorSignature([document])
  if (expectedUniqueKeys) {
    if (diagnostics.length !== 1 || diagnostics[0].code !== 'DUPLICATE_KEY'
      || JSON.stringify(diagnostics[0].pos) !== JSON.stringify([5, 6])) {
      throw new Error('duplicate-key policy did not emit exactly DUPLICATE_KEY at [5,6]')
    }
  } else if (diagnostics.length !== 0) {
    throw new Error('duplicate-key policy emitted a diagnostic for the repeated key')
  }

  const value = document.toJS()
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || value.a !== 2) {
    throw new Error('duplicate-key policy did not retain the last-wins value { a: 2 }')
  }
  return { uniqueKeys, diagnostics, value }
}

export function documentSourceTokenIdentity(api, document, tokens) {
  return assertProviderDocument(api, document, tokens)
}

export function serverAstBacklinks(internalDocument, root, api, sourceTokens) {
  if (!root || typeof root !== 'object') throw new Error('server did not produce an AST root')
  const seen = new Set()
  const stack = [root]
  let linked = false
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (node.internalNode) {
      linked = true
      const yamlNode = node.internalNode
      if (![api.isScalar?.(yamlNode), api.isPair?.(yamlNode), api.isMap?.(yamlNode), api.isSeq?.(yamlNode), api.isAlias?.(yamlNode)].some(Boolean)) {
        throw new Error('server AST internalNode has the wrong yaml-provider brand')
      }
    }
    for (const key of Object.keys(node)) {
      const value = Object.getOwnPropertyDescriptor(node, key)?.value
      if (Array.isArray(value)) stack.push(...value)
      else if (value && typeof value === 'object') stack.push(value)
    }
  }
  if (!linked || !internalDocument.contents?.srcToken || !tokenGraphContains(sourceTokens, internalDocument.contents.srcToken)) {
    throw new Error('server AST did not backlink to its internal provider node/token')
  }
  return { astNodes: seen.size, linked: true }
}
