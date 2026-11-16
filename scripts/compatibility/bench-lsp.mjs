#!/usr/bin/env node
// Semantic contract and isolated provider harness for the real YAML language-server parse path.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  SERVER_ENTRY, SERVER_TAGS_ENTRY, assertCstLossless, assertProviderDocument, assertYamlProvider,
  assertAliasResolvesTo, assertCustomTagReturnType, assertDiagnosticPosition, assertLineStarts,
  assertRootScalarValue, assertYamlResolutions, createYamlResolverHook, enumerateErrorSignature, findPackageRoot,
  getRegisterHooks, gitProvenance, hashFile, hashModuleClosure, importYamlProvider,
  graphSnapshot, packageProvenance, runBareOperation, serverAstBacklinks, sha256, sourceLineStarts,
  tokenGraphContains, validateWorkerEnvelope
} from './lsp-contract.mjs'
import { createCampaignBudget, runMeasurementPhase, validatePhaseResult } from './lsp-measure.mjs'
import { enumerateCells, expandDocumentStream, loadPinnedCorpus, semanticSources } from './lsp-fixtures.mjs'

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '../..')
const scriptPath = resolve(process.argv[1])
const EXPECTED_SERVER_HEAD = '4bf9c818850bf9751696d24848fdeaececb4203c'
const EXPECTED_CANDIDATE_HEAD = '8ea0498b65b80806dfd67d1815b4faefcdede04e'
const EXPECTED_CANDIDATE_ARTIFACTS = {
  'yaml-compat.js': 'f040321d97d55c6692c1a04c01d53eea2875dc8b5409f1ce7cfc271b4fac83d2',
  'yaml-compat.cjs': '587e54c0c897e1ee58a4604136a4199fe2a826368caeb49f236efe0295a233a3',
  'yaml-compat.d.ts': 'e875ec6cc4fc3404486f33b3a695a91b921ac07ee10b48f6b40bdc9393d3d5f0',
  'yaml-compat.d.cts': 'e875ec6cc4fc3404486f33b3a695a91b921ac07ee10b48f6b40bdc9393d3d5f0'
}
const DEFAULT_SERVER_ENTRY = 'out/src/languageservice/parser/yamlParser07.js'
const TAG_SETTINGS = ['!count scalar:number', '!record mapping:object']

function fail(message) { throw new Error(message) }
function candidateArtifactHashes(entry) {
  const directory = dirname(resolve(entry))
  return Object.fromEntries(Object.entries(EXPECTED_CANDIDATE_ARTIFACTS).map(([name, expected]) => {
    const artifact = hashFile(join(directory, name))
    if (artifact.sha256 !== expected) fail(`${name} hash differs from the reviewed candidate artifact`)
    return [name, artifact]
  }))
}
function serverArtifactHashes(root) {
  const aliasRoot = join(root, 'node_modules/yaml')
  const aliasPackage = JSON.parse(readFileSync(join(aliasRoot, 'package.json'), 'utf8'))
  if (aliasPackage.version !== '2.8.3-lightning-adapter') fail(`unexpected installed yaml alias version ${aliasPackage.version}`)
  const entry = join(root, SERVER_ENTRY)
  return {
    compiledEntry: hashFile(entry),
    compiledTags: hashFile(join(root, SERVER_TAGS_ENTRY)),
    compiledClosure: hashModuleClosure(entry),
    installedYamlAlias: {
      name: aliasPackage.name,
      version: aliasPackage.version,
      packageJson: hashFile(join(aliasRoot, 'package.json')),
      runtimeReexport: hashFile(join(aliasRoot, 'index.js')),
      typesReexport: hashFile(join(aliasRoot, 'index.d.ts'))
    }
  }
}
function isObject(value) { return value !== null && typeof value === 'object' }
function walkNodes(root, api) {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!isObject(node) || seen.has(node)) continue
    seen.add(node)
    if (api.isPair?.(node)) stack.push(node.key, node.value)
    else if (api.isMap?.(node) || api.isSeq?.(node)) stack.push(...node.items)
  }
  return seen
}
function getMapPair(api, node, key) {
  if (!api.isMap?.(node)) return undefined
  return node.items.find((pair) => api.isPair?.(pair) && pair.key?.value === key)
}
function textValue(doc) {
  return doc.toJS()
}
function createTracedTags(getCustomTags, trace) {
  const tags = getCustomTags(TAG_SETTINGS)
  for (const tag of tags) {
    if (typeof tag.resolve !== 'function') continue
    const original = tag.resolve.bind(tag)
    tag.resolve = (...args) => {
      trace.push({ tag: tag.tag, argumentKind: args[0] === null ? 'null' : Array.isArray(args[0]) ? 'array' : typeof args[0] })
      return original(...args)
    }
  }
  return tags
}
function createApplicationTags(api, trace) {
  return [
    { tag: '!include', resolve(value, onError) {
      trace.push({ tag: '!include', value })
      if (typeof value === 'string' && value.trim()) return value
      onError('!include without value')
    } },
    { tag: '!count', resolve(value) {
      trace.push({ tag: '!count', value })
      const scalar = new api.Scalar(value)
      scalar.customTagReturnType = 'number'
      return scalar
    } },
    { tag: '!record', collection: 'map', resolve(value) {
      trace.push({ tag: '!record', kind: 'map' })
      value.customTagReturnType = 'object'
      return value
    } }
  ]
}
function collectProviderEvidence(api, source, result) {
  assertCstLossless(api, result.tokens, source)
  for (const document of result.documents) assertProviderDocument(api, document, result.tokens)
  return {
    sourceBytes: Buffer.byteLength(source),
    sourceUtf16: source.length,
    sourceSha256: sha256(source),
    tokenCount: result.tokens.length,
    documentCount: result.documents.length,
    ranges: result.documents.map((document) => document.range),
    diagnostics: enumerateErrorSignature(result.documents),
    lineStarts: result.lineCounter.lineStarts.slice(),
    graphSnapshots: result.documents.map((document) => graphSnapshot(document, api)),
    contentsKinds: result.documents.map((document) => api.isMap?.(document.contents) ? 'Map'
      : api.isSeq?.(document.contents) ? 'Seq' : api.isScalar?.(document.contents) ? 'Scalar' : 'empty')
  }
}
function assertAliasIdentity(api, doc, tokenList) {
  const anchorPair = getMapPair(api, doc.contents, 'anchor')
  const anchoredNode = anchorPair?.value
  if (!anchoredNode) fail('alias source does not contain the expected anchor')
  assertAliasResolvesTo(api, doc, tokenList, anchoredNode)
  return { anchorNodeIdentity: true, aliasNodeIdentity: true }
}
function assertCustomTags(api, doc, trace) {
  const values = [...walkNodes(doc.contents, api)]
  const includePair = getMapPair(api, doc.contents, 'include')
  const countPair = getMapPair(api, doc.contents, 'scalar')
  const recordPair = getMapPair(api, doc.contents, 'object')
  if (includePair?.value?.value !== 'value.yaml') fail('server !include did not preserve its scalar value')
  if (countPair?.value?.value !== '12') fail('!count scalar value is missing')
  assertCustomTagReturnType(countPair.value, 'number')
  assertCustomTagReturnType(recordPair?.value, 'object')
  if (trace && (!trace.some((call) => call.tag === '!count') || !trace.some((call) => call.tag === '!record'))) fail('custom tag callbacks were not observed')
  return { include: includePair.value.value, count: countPair.value.value, countReturnType: countPair.value.customTagReturnType,
    recordReturnType: recordPair.value.customTagReturnType, nodeCount: values.length, callbackTrace: trace ?? [] }
}
function assertRecovery(api, documents) {
  if (documents.length !== 3) fail(`recovery stream produced ${documents.length} documents, expected 3`)
  if (documents[0].errors.length || documents[2].errors.length) fail('recovery errors leaked into a neighboring document')
  const bad = documents[1].errors.find((error) => error.code === 'BAD_INDENT')
  if (!bad || bad.pos[0] !== 19 || bad.pos[1] !== 20) fail('malformed middle document diagnostic changed')
  const partial = textValue(documents[1])
  if (JSON.stringify(partial) !== JSON.stringify({ items: [] })) fail('malformed middle document partial value changed')
  return { documentCount: documents.length, middleError: { code: bad.code, pos: [...bad.pos] }, partial }
}
function assertInlineRecovery(api, document) {
  if (document.errors.length !== 1) fail('inline flow recovery diagnostic count changed')
  assertDiagnosticPosition(document, document.errors[0].code, [11, 12])
  const value = textValue(document)
  if (value.items?.[0] !== 'a' || value.next !== 1) fail('inline flow recovery did not retain subsequent mapping')
  return { diagnostics: enumerateErrorSignature([document]), value }
}
function assertDuplicatePolicies(api, provider, source) {
  const defaultResult = runBareOperation(api, source)
  const defaultDoc = defaultResult.documents[0]
  const literalUniqueKeys = defaultDoc.options.uniqueKeys
  const expectedDefault = provider === 'reference' ? true : false
  if (literalUniqueKeys !== expectedDefault) fail(`${provider} literal uniqueKeys default changed`)
  const falseResult = runBareOperation(api, source, { policy: 'uniqueKeys-false' })
  const trueResult = runBareOperation(api, source, { policy: 'uniqueKeys-true' })
  if (falseResult.documents[0].errors.length !== 0) fail(`${provider} explicit uniqueKeys:false rejected duplicates`)
  if (!trueResult.documents[0].errors.some((error) => error.code === 'DUPLICATE_KEY' && error.pos[0] === 5 && error.pos[1] === 6)) {
    fail(`${provider} explicit uniqueKeys:true did not report the duplicate`)
  }
  const compareResult = runBareOperation(api, 'A: 1\na: 2\n', { policy: 'uniqueKeys-comparator' })
  if (!compareResult.documents[0].errors.some((error) => error.code === 'DUPLICATE_KEY' && error.pos[0] === 5 && error.pos[1] === 6)) {
    fail(`${provider} comparator policy did not report the duplicate`)
  }
  const comparatorResult = compareResult
  if (comparatorResult.uniqueKeysTrace.length !== 1) fail(`${provider} duplicate comparator invocation trace changed`)

  return {
    literalUniqueKeys,
    literalDefaultDiagnostics: enumerateErrorSignature([defaultDoc]),
    explicitFalseErrors: falseResult.documents[0].errors.length,
    explicitTrueDiagnostics: enumerateErrorSignature(trueResult.documents),
    comparatorCalls: comparatorResult.uniqueKeysTrace,
    comparatorDiagnostics: enumerateErrorSignature(comparatorResult.documents)
  }
}

function checkBareProvider(api, provider, fixtures) {
  assertYamlProvider(api, provider)
  const corpus = []
  for (const fixture of fixtures) {
    const result = runBareOperation(api, fixture.source)
    if (result.documents.length !== fixture.expectedDocuments) fail(`${fixture.id}: document count changed`)
    corpus.push({ id: fixture.id, ...collectProviderEvidence(api, fixture.source, result) })
  }
  const utf16 = assertUtf16Vector(api)
  const aliasResult = runBareOperation(api, semanticSources.aliases)
  const alias = assertAliasIdentity(api, aliasResult.documents[0], aliasResult.tokens)
  const recovery = runBareOperation(api, semanticSources.recovery)
  const recoveryEvidence = assertRecovery(api, recovery.documents)
  const inline = runBareOperation(api, semanticSources.recoveryInline)
  const inlineRecovery = assertInlineRecovery(api, inline.documents[0])
  const duplicate = assertDuplicatePolicies(api, provider, semanticSources.duplicateKeys)
  const rootIndent = runBareOperation(api, semanticSources.rootIndent)
  const expectedRootIndent = provider === 'reference' ? 'hello\n' : ' hello\n'
  const rootIndentValue = assertRootScalarValue(api, rootIndent.documents[0], rootIndent.tokens, expectedRootIndent).value
  const contextFreeScalar = api.CST.resolveAsScalar(rootIndent.documents[0].contents.srcToken, false)
  if (contextFreeScalar.value !== 'hello\n') fail(`${provider} context-free CST scalar control changed`)
  const customTrace = []
  const custom = runBareOperation(api, semanticSources.customTags, {
    customTagsFactory: () => createTracedTags(() => createApplicationTags(api, customTrace), customTrace)
  })
  custom.documents[0].toJS()
  const customEvidence = assertCustomTags(api, custom.documents[0], customTrace)
  return {
    provider,
    package: provider === 'reference' ? 'yaml@2.9.0' : 'external candidate entry',
    corpus,
    utf16,
    alias,
    recovery: recoveryEvidence,
    inlineRecovery,
    duplicates: duplicate,
    rootIndent: { composerValue: rootIndentValue, contextFreeCstValue: contextFreeScalar.value,
      valueByProvider: { reference: 'hello\\n', candidate: ' hello\\n' } },
    customTags: customEvidence,
    includeWithoutValueDiagnostics: []
  }
}

function assertUtf16Vector(api) {
  const source = 'x: "😀"\r\nbad: [1,\r\n'
  const result = runBareOperation(api, source)
  const document = result.documents[0]
  const error = document?.errors.find((item) => item.code === 'BAD_INDENT')
  if (!error || error.pos[0] !== 19 || error.pos[1] !== 20) fail('UTF-16 CRLF diagnostic did not remain at [19,20]')
  if (source.length !== 19 || [...source].length !== 18) fail('UTF-16 witness source changed')
  assertCstLossless(api, result.tokens, source)
  return { sourceSha256: sha256(source), sourceUtf16: source.length, codePoints: [...source].length, code: error.code, pos: [...error.pos] }
}

function serverTextDocument(serverRoot) {
  const require = createRequire(join(serverRoot, 'package.json'))
  const namespace = require('vscode-languageserver-textdocument')
  const api = namespace.TextDocument ? namespace : namespace.default
  if (typeof api?.TextDocument?.create !== 'function') fail('server TextDocument.create is unavailable')
  return api.TextDocument
}

function mapDocumentMode(mode) {
  if (mode === 'none') return { id: 'absent', source: semanticSources.callbackNonemptyFinalLine, document: null }
  if (mode === 'nonempty-final-line') return { id: mode, source: semanticSources.callbackNonemptyFinalLine, document: true }
  if (mode === 'empty-final-line') return { id: mode, source: semanticSources.callbackEmptyFinalLine, document: true }
  if (mode === 'whitespace-final-line') return { id: mode, source: semanticSources.callbackWhitespaceFinalLine, document: true }
  if (mode === 'cr-only-whitespace-final-line') return { id: mode, source: semanticSources.callbackCrOnlyFinalLine, document: true }
  if (mode === 'no-trailing-newline') return { id: mode, source: 'head: "😀"\r\nitems:\r\n  - one', document: null }
  if (mode === 'lf-counterpart') return { id: mode, source: 'head: "😀"\nitems:\n  - one\n', document: null }
  throw new Error(`unknown document mode ${mode}`)
}

function getServerDocumentValues(yamlDocument) {
  return yamlDocument.documents.map((single) => single.internalDocument)
}
function assertRangesAndDiagnostics(referenceDocs, actualDocs, context) {
  if (referenceDocs.length !== actualDocs.length) fail(`${context}: bare/server document counts differ`)
  for (let i = 0; i < referenceDocs.length; i++) {
    const left = referenceDocs[i]
    const right = actualDocs[i]
    if (JSON.stringify(left.range) !== JSON.stringify(right.range)) fail(`${context}: document ${i} range differs between bare and server`)
    const errorsA = left.errors.map(({ code, pos }) => ({ code, pos }))
    const errorsB = right.errors.map(({ code, pos }) => ({ code, pos }))
    if (JSON.stringify(errorsA) !== JSON.stringify(errorsB)) fail(`${context}: document ${i} diagnostic code/position differs between bare and server`)
  }
}

function checkCloneAndStructuredClone(api, serverDoc, sortedServerDoc) {
  const originalDoc = serverDoc.documents[0]
  const originalValue = originalDoc.internalDocument.toJS()
  const clone = originalDoc.clone()
  clone.internalDocument.setIn(['m', 'x'], 2)
  clone.updateFromInternalDocument()
  const changed = clone.internalDocument.toJS()
  if (JSON.stringify(originalValue) !== JSON.stringify({ m: { x: 1 } }) || JSON.stringify(changed) !== JSON.stringify({ m: { x: 2 } })) {
    fail('server SingleYAMLDocument clone/edit contract changed')
  }
  if (clone.root === originalDoc.root) fail('edited clone reused the original server AST root')
  const mapToken = sortedServerDoc.documents[0].internalDocument.contents.srcToken
  const copiedToken = structuredClone(mapToken)
  if (!Array.isArray(copiedToken.items)) fail('structuredClone token did not retain ordinary item arrays')
  copiedToken.items.sort((left, right) => String(left.key?.source).localeCompare(String(right.key?.source)))
  const sorted = api.CST.stringify(copiedToken)
  if (!sorted.includes('a: 2') || !sorted.includes('z: 1')) fail('structured-cloned edited token did not serialize sorted entries')
  if (api.CST.stringify(mapToken).indexOf('z: 1') > api.CST.stringify(mapToken).indexOf('a: 2')) fail('structured-clone sort mutated original CST token order')
  return { cloneValue: changed, sourceMapTokenItems: mapToken.items.length, clonedTokenItems: copiedToken.items.length, sortedText: sorted }
}

function checkEscapedSubtree(api, parserModule) {
  const escaped = (() => {
    const parsed = parserModule.parse('keep: {nested: [value]}\n', { yamlVersion: '1.2', customTags: TAG_SETTINGS })
    return getMapPair(api, parsed.documents[0].internalDocument.contents, 'keep')?.value
  })()
  const nested = getMapPair(api, escaped, 'nested')?.value
  if (!api.isMap?.(escaped) || !api.isSeq?.(nested) || nested.items[0]?.value !== 'value') {
    fail('escaped YAML subtree stopped working after its outer document was released')
  }
  return { escapedNodeBrand: 'Map', nestedNodeBrand: 'Seq', value: nested.items[0].value }
}

async function checkServer(api, providerVersion, serverRoot, parserModule, getCustomTags, fixtures, resolutions, referenceEntry) {
  assertYamlProvider(api, 'injected server provider')
  const TextDocument = serverTextDocument(serverRoot)
  const cases = []
  const sourceCases = [
    ...fixtures.map((fixture) => ({ id: fixture.id, source: fixture.source, expectedDocuments: fixture.expectedDocuments })),
    { id: 'alias-identity', source: semanticSources.aliases, expectedDocuments: 1 },
    { id: 'malformed-recovery', source: semanticSources.recovery, expectedDocuments: 3 },
    { id: 'malformed-inline-recovery', source: semanticSources.recoveryInline, expectedDocuments: 1 },
    { id: 'utf16-crlf', source: 'x: "😀"\r\nbad: [1,\r\n', expectedDocuments: 1 },
    { id: 'custom-tags', source: semanticSources.customTags, expectedDocuments: 1 },
    { id: 'custom-include-missing-value', source: semanticSources.includeMissing, expectedDocuments: 1 },
    { id: 'duplicate-default', source: semanticSources.duplicateKeys, expectedDocuments: 1 },
    { id: 'root-indent-profile', source: semanticSources.rootIndent, expectedDocuments: 1 }
  ]
  for (const item of sourceCases) {
    const options = { yamlVersion: '1.2', customTags: TAG_SETTINGS }
    const serverResult = parserModule.parse(item.source, options)
    if (!Array.isArray(serverResult.tokens) || !Array.isArray(serverResult.documents)) fail(`${item.id}: server parser return shape changed`)
    if (serverResult.documents.length !== item.expectedDocuments) fail(`${item.id}: server document count changed`)
    assertCstLossless(api, serverResult.tokens, item.source)
    const customTags = createTracedTags(getCustomTags, [])
    const direct = runBareOperation(api, item.source, { customTags, captureLineCallbacks: true })
    assertRangesAndDiagnostics(direct.documents, getServerDocumentValues(serverResult), item.id)
    for (const document of direct.documents) assertProviderDocument(api, document, direct.tokens)
    for (const single of serverResult.documents) {
      if (!single.internalDocument || !(single.internalDocument instanceof api.Document)) fail(`${item.id}: server did not retain provider Document`)
      if (single.internalDocument.contents && !tokenGraphContains(serverResult.tokens, single.internalDocument.contents.srcToken)) fail(`${item.id}: server AST token identity was lost`)
      if (single.root && single.internalDocument.contents) serverAstBacklinks(single.internalDocument, single.root, api, serverResult.tokens)
    }
    const uniqueKeys = serverResult.documents[0]?.internalDocument.options.uniqueKeys
    cases.push({
      id: item.id,
      sourceBytes: Buffer.byteLength(item.source),
      sourceUtf16: item.source.length,
      sourceSha256: sha256(item.source),
      documentCount: serverResult.documents.length,
      ranges: getServerDocumentValues(serverResult).map((document) => document.range),
      diagnostics: getServerDocumentValues(serverResult).flatMap((document) => enumerateErrorSignature([document])),
      lineStarts: serverResult.documents[0]?.lineCounter?.lineStarts.slice() ?? [],
      literalUniqueKeys: uniqueKeys
    })
  }

  const callbackModes = ['none', 'no-trailing-newline', 'nonempty-final-line', 'empty-final-line', 'whitespace-final-line', 'lf-counterpart', 'cr-only-whitespace-final-line']
  const callbackCases = []
  for (const mode of callbackModes) {
    const item = mapDocumentMode(mode)
    const document = item.document
      ? TextDocument.create(`file:///lsp-p0a-${mode}.yaml`, 'yaml', 1, item.source)
      : undefined
    const serverResult = parserModule.parse(item.source, { yamlVersion: '1.2', customTags: TAG_SETTINGS }, document)
    const direct = runBareOperation(api, item.source, { customTags: getCustomTags(TAG_SETTINGS), captureLineCallbacks: true, document: document ?? null })
    assertCstLossless(api, serverResult.tokens, item.source)
    assertRangesAndDiagnostics(direct.documents, getServerDocumentValues(serverResult), `callback:${mode}`)
    const actualStarts = serverResult.documents[0]?.lineCounter?.lineStarts ?? []
    assertLineStarts(actualStarts, direct.lineCounter.lineStarts)
    const finalLine = item.source.split(/\r\n|\n|\r/).at(-1) ?? ''
    const expectedStarts = document && finalLine.trim().length === 0 ? [] : sourceLineStarts(item.source)
    assertLineStarts(actualStarts, expectedStarts)
    callbackCases.push({ id: mode, sourceSha256: sha256(item.source), documentProvided: Boolean(document), finalLineEmpty: finalLine.trim().length === 0, lineStarts: actualStarts.slice() })
  }

  const aliasServer = parserModule.parse(semanticSources.aliases, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const aliasDocument = aliasServer.documents[0].internalDocument
  const aliasEvidence = assertAliasIdentity(api, aliasDocument, aliasServer.tokens)
  const recoveryServer = parserModule.parse(semanticSources.recovery, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const recoveryEvidence = assertRecovery(api, getServerDocumentValues(recoveryServer))
  const recoveryInline = parserModule.parse(semanticSources.recoveryInline, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const inlineEvidence = assertInlineRecovery(api, recoveryInline.documents[0].internalDocument)

  const customTrace = []
  const customResult = parserModule.parse(semanticSources.customTags, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const customDoc = customResult.documents[0]
  const customNodes = [...walkNodes(customDoc.internalDocument.contents, api)]
  const include = getMapPair(api, customDoc.internalDocument.contents, 'include')
  const count = getMapPair(api, customDoc.internalDocument.contents, 'scalar')
  const record = getMapPair(api, customDoc.internalDocument.contents, 'object')
  if (include?.value?.value !== 'value.yaml' || count?.value?.value !== '12' || count.value.customTagReturnType !== 'number' || record?.value?.customTagReturnType !== 'object') {
    fail('actual server custom-tag metadata/value contract changed')
  }
  const directCustomTags = createTracedTags(getCustomTags, customTrace)
  const directCustom = runBareOperation(api, semanticSources.customTags, { customTags: directCustomTags })
  const directCustomDocument = directCustom.documents[0]
  directCustomDocument.toJS()
  const directCustomEvidence = assertCustomTags(api, directCustomDocument, customTrace)
  if (!customTrace.some((call) => call.tag === '!count') || !customTrace.some((call) => call.tag === '!record')) {
    fail('actual server custom tag definitions did not run both traced callbacks')
  }
  const missingInclude = parserModule.parse(semanticSources.includeMissing, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  if (!missingInclude.documents[0].internalDocument.errors.some((error) => error.pos[0] === 9 && error.pos[1] === 17)) fail('actual server !include missing-value diagnostic changed')

  const duplicate = parserModule.parse(semanticSources.duplicateKeys, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const duplicateUniqueKeys = duplicate.documents[0].internalDocument.options.uniqueKeys
  const expectedLiteralUniqueKeys = providerVersion === '2.9.0' ? true : false
  if (duplicateUniqueKeys !== expectedLiteralUniqueKeys) fail('actual server literal uniqueKeys policy changed')

  const rootIndent = parserModule.parse(semanticSources.rootIndent, { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const rootIndentDocument = rootIndent.documents[0].internalDocument
  const rootIndentValue = rootIndentDocument.contents?.value
  const directRootIndent = runBareOperation(api, semanticSources.rootIndent, { customTags: getCustomTags(TAG_SETTINGS) })
  const directRootIndentValue = directRootIndent.documents[0].contents?.value
  const contextFreeRootValue = api.CST.resolveAsScalar(directRootIndent.documents[0].contents.srcToken, false).value
  const rootAstValue = rootIndent.documents[0].root?.value
  const expectedRootIndent = providerVersion === '2.9.0' ? 'hello\n' : ' hello\n'
  assertRootScalarValue(api, rootIndentDocument, rootIndent.tokens, expectedRootIndent)
  assertRootScalarValue(api, directRootIndent.documents[0], directRootIndent.tokens, expectedRootIndent)
  if (rootIndentValue !== expectedRootIndent || directRootIndentValue !== rootIndentValue || rootAstValue !== rootIndentValue || contextFreeRootValue !== 'hello\n') {
    fail(`root-indent stages differ: direct=${JSON.stringify(directRootIndentValue)} internal=${JSON.stringify(rootIndentValue)} serverAST=${JSON.stringify(rootAstValue)} CST=${JSON.stringify(contextFreeRootValue)}`)
  }

  const cloneInput = parserModule.parse('m: {x: 1}\n', { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const sortedInput = parserModule.parse('z: 1\na: 2\n', { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  const cloneEvidence = checkCloneAndStructuredClone(api, cloneInput, sortedInput)
  const escapedSubtree = checkEscapedSubtree(api, parserModule)
  const unresolved = parserModule.parse('copy: *missing\n', { yamlVersion: '1.2', customTags: TAG_SETTINGS })
  if (unresolved.documents[0].internalDocument.errors.length !== 0) fail('unresolved alias moved into composition diagnostics')
  let unresolvedStage = 'no error'
  try { unresolved.documents[0].internalDocument.toJS() } catch (error) { unresolvedStage = `${error.name}: ${error.message}` }
  if (!unresolvedStage.startsWith('ReferenceError: Unresolved alias')) fail('unresolved alias did not fail during toJS conversion')

  const serverPackage = findPackageRoot(join(serverRoot, SERVER_ENTRY), 'yaml-language-server')
  const serverDep = serverPackage.package.dependencies?.yaml
  if (serverDep !== '2.8.3') fail(`declared server dependency changed from 2.8.3 to ${serverDep}`)
  assertYamlResolutions(resolutions, resolve(referenceEntry), serverRoot)
  return {
    cases,
    callbackCases,
    alias: aliasEvidence,
    recovery: recoveryEvidence,
    inlineRecovery: inlineEvidence,
    customTags: { include: include.value.value, scalar: count.value.value, scalarReturnType: count.value.customTagReturnType,
      recordReturnType: record.value.customTagReturnType, callbackTrace: customTrace, astNodes: customNodes.size,
      directDefinitionEvidence: directCustomEvidence },
    duplicateDefaults: { declaredServerDependency: serverDep, injectedPackageVersion: providerVersion, literalUniqueKeys: duplicateUniqueKeys, statusOnly: true },
    rootIndent: { providerVersion, directComposerValue: directRootIndentValue, internalDocumentValue: rootIndentValue, serverAstValue: rootAstValue,
      contextFreeCstValue: contextFreeRootValue, providerSpecific: true, statusOnly: true },
    cloneAndStructuredClone: cloneEvidence,
    escapedSubtree,
    unresolvedAlias: { compositionDiagnostics: 0, toJS: unresolvedStage },
    server: {
      root: serverPackage.root,
      packageVersion: serverPackage.package.version,
      entry: hashFile(join(serverRoot, SERVER_ENTRY)),
      closure: hashModuleClosure(join(serverRoot, SERVER_ENTRY)),
      customTagsEntry: hashFile(join(serverRoot, SERVER_TAGS_ENTRY)),
      declaredYamlDependency: serverDep
    },
    yamlResolutions: resolutions
  }
}

function parseArgs(args) {
  const result = { mode: null, selfCheck: false, batch: null, cells: null, values: {} }
  if (args[0] === '--') args = args.slice(1)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--check' || arg === '--measure' || arg === '--plan') {
      if (result.mode) fail('choose one explicit mode: --check or --measure')
      result.mode = arg.slice(2)
    } else if (arg === '--self-check') result.selfCheck = true
    else if (['--candidate-root', '--candidate-entry', '--candidate-head', '--server-root', '--server-head', '--reference-entry', '--output', '--batch', '--cells'].includes(arg)) {
      if (!args[i + 1]) fail(`${arg} requires a value`)
      result.values[arg.slice(2)] = args[++i]
    } else fail(`unknown argument ${arg}`)
  }
  return result
}

function spawnWorker(config) {
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64url')
  const child = spawnSync(process.execPath, [scriptPath, '--worker', encoded], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: config.timeoutMs ?? 30_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, LOG_TOKENS: '' }
  })
  if (child.error) fail(`worker spawn failed: ${child.error.message}`)
  if (child.status !== 0) fail(`worker ${config.workerId} exited ${child.status}: ${(child.stderr || '').trim()}`)
  const fixtures = loadPinnedCorpus(repoRoot)
  const expectedInputSha256 = Object.fromEntries(fixtures.map((fixture) => [fixture.id, fixture.sha256]))
  const output = validateWorkerEnvelope(child.stdout, {
    workerId: config.workerId,
    expectedHead: config.expectedHead,
    cellIds: config.cellIds,
    expectedInputSha256
  })
  for (const cell of output.cells) {
    const semanticEvidence = config.kind === 'bare-check'
      ? output.evidence.corpus.find((item) => item.id === cell.id)
      : output.evidence.cases.find((item) => item.id === cell.id)
    if (!semanticEvidence || cell.outputSha256 !== sha256(JSON.stringify(semanticEvidence))) {
      fail(`worker ${config.workerId} returned a mismatched output checksum for ${cell.id}`)
    }
  }
  return output
}

async function runBareWorker(config) {
  const { api, provenance } = await importYamlProvider(config.entry)
  assertYamlProvider(api, config.label)
  const fixtures = loadPinnedCorpus(repoRoot)
  const evidence = checkBareProvider(api, config.label, fixtures)
  const cells = config.cellIds.map((id) => {
    const fixture = fixtures.find((item) => item.id === id)
    if (!fixture) fail(`unknown requested fixture cell ${id}`)
    return { id, inputSha256: fixture.sha256, outputSha256: sha256(JSON.stringify(evidence.corpus.find((item) => item.id === id))), evidence: 'semantic-check' }
  })
  return { workerId: config.workerId, head: config.expectedHead, provider: config.label, provenance, evidence, cells }
}

async function runServerWorker(config) {
  const registerHooks = await getRegisterHooks()
  if (!registerHooks) fail('actual-server checks require Node with synchronous node:module.registerHooks support')
  const resolutions = []
  const hook = registerHooks(createYamlResolverHook(config.entry, resolutions))
  try {
    const { api, provenance } = await importYamlProvider(config.entry)
    assertYamlProvider(api, config.label)
    const parserPath = resolve(config.serverRoot, SERVER_ENTRY)
    const tagsPath = resolve(config.serverRoot, SERVER_TAGS_ENTRY)
    const parserModule = await import(pathToFileURL(parserPath).href)
    const tagsModule = await import(pathToFileURL(tagsPath).href)
    if (typeof parserModule.parse !== 'function' || typeof tagsModule.getCustomTags !== 'function') fail('compiled server parse/getCustomTags entrypoints are missing')
    const fixtures = loadPinnedCorpus(repoRoot)
    const evidence = await checkServer(api, provenance.version, config.serverRoot, parserModule, tagsModule.getCustomTags, fixtures, resolutions, config.entry)
    return { workerId: config.workerId, head: config.expectedHead, provider: config.label, provenance, evidence,
      cells: config.cellIds.map((id) => {
        const fixture = fixtures.find((item) => item.id === id)
        const semanticCell = evidence.cases.find((item) => item.id === id)
        if (!fixture || !semanticCell) fail(`actual-server worker lacks semantic evidence for ${id}`)
        return { id, inputSha256: fixture.sha256, outputSha256: sha256(JSON.stringify(semanticCell)), evidence: 'actual-server-semantic-check' }
      }) }
  } finally {
    hook?.deregister?.()
  }
}

function measurementSummary(result, api, source, serverPath, expectedDocumentCount) {
  if (Array.isArray(result)) return result.map((item) => measurementSummary(item, api, source, serverPath, expectedDocumentCount))
  const tokens = result.tokens
  assertCstLossless(api, tokens, source)
  const documents = serverPath ? result.documents.map((single) => single.internalDocument) : result.documents
  if (documents.length !== expectedDocumentCount) {
    fail(`measurement operation produced ${documents.length} documents, expected ${expectedDocumentCount}`)
  }
  const values = documents.map((document) => {
    let value
    let conversionError = null
    try { value = document.toJS() } catch (error) { conversionError = `${error.name}: ${error.message}` }
    return { range: document.range, diagnostics: enumerateErrorSignature([document]), value, conversionError }
  })
  return { sourceSha256: sha256(source), tokenCount: tokens.length, documents: values }
}

async function measureWorker(config) {
  const source = readFileSync(config.sourceFile, 'utf8')
  const startupStart = performance.now()
  const { api, provenance } = await importYamlProvider(config.entry)
  assertYamlProvider(api, config.label)
  let operation
  let serverResolution = null
  let unregisterHook = () => {}
  if (config.serverMode) {
    const registerHooks = await getRegisterHooks()
    if (!registerHooks) fail('actual-server measurements require Node with synchronous node:module.registerHooks support')
    const resolutions = []
    const hook = registerHooks(createYamlResolverHook(config.entry, resolutions))
    try {
      const parserModule = await import(pathToFileURL(resolve(config.serverRoot, SERVER_ENTRY)).href)
      const tagModule = await import(pathToFileURL(resolve(config.serverRoot, SERVER_TAGS_ENTRY)).href)
      if (typeof parserModule.parse !== 'function' || typeof tagModule.getCustomTags !== 'function') fail('compiled server measurement entrypoints are missing')
      const TextDocument = serverTextDocument(config.serverRoot)
      const document = config.documentMode === 'absent'
        ? undefined
        : TextDocument.create(`file:///lsp-measure-${config.cellId}.yaml`, 'yaml', 1, source)
      operation = () => parserModule.parse(source, { yamlVersion: '1.2', customTags: TAG_SETTINGS }, document)
      serverResolution = { resolutions, target: resolve(config.entry) }
      unregisterHook = hook?.deregister?.bind(hook) ?? unregisterHook
    } catch (error) {
      hook?.deregister?.()
      throw error
    }
  } else {
    operation = () => runBareOperation(api, source, { policy: config.policy })
  }
  const startupMs = performance.now() - startupStart
  try {
    let phase
    if (config.phase === 'semantic-only') {
      const checked = operation()
      phase = {
        phase: config.phase,
        warmups: 0,
        iterations: 1,
        resultCount: 1,
        output: measurementSummary(checked, api, source, config.serverMode, config.expectedDocumentCount)
      }
    } else {
      phase = runMeasurementPhase({
        phase: config.phase,
        operation,
        warmups: config.phase === 'isolated-peak-rss' ? 0 : config.warmups,
        iterations: config.phase === 'isolated-peak-rss' ? 1 : config.iterations,
        summarize: (result) => measurementSummary(result, api, source, config.serverMode, config.expectedDocumentCount)
      })
    }
    if (serverResolution) assertYamlResolutions(serverResolution.resolutions, serverResolution.target, config.serverRoot)
    const outputSha256 = sha256(JSON.stringify(phase.output))
    return {
      workerId: config.workerId,
      head: config.expectedHead,
      cellId: config.cellId,
      participant: config.participant,
      phase: config.phase,
      inputSha256: config.inputSha256,
      outputSha256,
      startupMs,
      ...phase,
      provenance,
      resolutions: serverResolution?.resolutions ?? []
    }
  } finally {
    unregisterHook()
  }
}

async function workerMain(encoded) {
  const config = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  const output = config.kind === 'bare-check' ? await runBareWorker(config)
    : config.kind === 'server-check' ? await runServerWorker(config)
      : config.kind === 'measure-phase' ? await measureWorker(config)
      : fail(`unknown worker kind ${config.kind}`)
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

function assertParticipant(root, expectedHead, label, { requireClean = true } = {}) {
  const info = gitProvenance(root)
  if (requireClean && info.dirty) fail(`${label} checkout is dirty: ${info.root}`)
  if (info.head !== expectedHead) fail(`${label} HEAD mismatch: expected ${expectedHead}, got ${info.head}`)
  return info
}

async function selfCheck(args) {
  if (!args.selfCheck || args.mode !== 'check') fail('--self-check is only valid with --check')
  const refEntry = resolve(args.values['reference-entry'] ?? createRequire(import.meta.url).resolve('yaml'))
  const refInfo = findPackageRoot(refEntry, 'yaml')
  if (refInfo.package.version !== '2.9.0') fail(`self-check requires stock yaml@2.9.0; found ${refInfo.package.version}`)
  const expectedSource = gitProvenance(repoRoot)
  const fixtures = loadPinnedCorpus(repoRoot)
  const workerIds = ['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform']
  const worker = spawnWorker({ kind: 'bare-check', workerId: 'self-reference', expectedHead: expectedSource.head,
    entry: refEntry, label: 'reference', cellIds: workerIds })
  const mainDist = resolve(repoRoot, 'dist/yaml-compat.js')
  let mainCapability = 'not-built'
  try {
    statSync(mainDist)
    const main = await importYamlProvider(mainDist)
    try { assertYamlProvider(main.api, 'shipped main yaml compatibility entry') }
    catch (error) {
      if (!/Composer\/Document support absent/.test(error.message)) throw error
      mainCapability = error.message
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const output = {
    kind: 'contract-self-check',
    status: 'passed',
    candidateCompatibility: false,
    scoredMeasurement: false,
    source: expectedSource,
    reference: { version: refInfo.package.version, ...worker.provenance },
    mainCapability,
    fixturePins: fixtures.map(({ id, localPath, bytes, utf16Length, sha256: digest, expectedDocuments, license, licenseSha256 }) => ({ id, localPath, bytes, utf16Length, sha256: digest, expectedDocuments, license, licenseSha256 })),
    evidence: worker.evidence
  }
  return output
}

async function actualCheck(args) {
  if (args.selfCheck) return selfCheck(args)
  if (args.mode !== 'check') fail('actual provider validation uses --check')
  const v = args.values
  for (const key of ['candidate-root', 'candidate-entry', 'candidate-head', 'server-root', 'server-head']) if (!v[key]) fail(`--check requires --${key}`)
  if (v['candidate-head'] !== EXPECTED_CANDIDATE_HEAD) fail(`candidate HEAD must be the reviewed source302 commit ${EXPECTED_CANDIDATE_HEAD}`)
  if (v['server-head'] !== EXPECTED_SERVER_HEAD) fail(`server HEAD must be ${EXPECTED_SERVER_HEAD}`)
  const candidate = assertParticipant(resolve(v['candidate-root']), v['candidate-head'], 'candidate')
  const server = assertParticipant(resolve(v['server-root']), v['server-head'], 'server')
  const referenceEntry = resolve(v['reference-entry'] ?? createRequire(import.meta.url).resolve('yaml'))
  const referencePkg = findPackageRoot(referenceEntry, 'yaml')
  if (referencePkg.package.version !== '2.9.0') fail(`reference provider must be stock yaml@2.9.0, got ${referencePkg.package.version}`)
  const candidatePackage = packageProvenance(resolve(v['candidate-entry']), 'lightning-yaml')
  if (candidatePackage.version !== '0.1.1') fail(`candidate package version changed: ${candidatePackage.version}`)
  if (resolve(candidatePackage.root) !== resolve(candidate.root)) fail('candidate entry is outside the named candidate checkout')
  const fixtures = loadPinnedCorpus(repoRoot)
  const cellIds = ['docker-compose-pihole-cloudflared-doh', 'kubernetes-zookeeper', 'github-actions-cmake-multi-platform']
  const candidateBare = spawnWorker({ kind: 'bare-check', workerId: 'source302-bare-provider', expectedHead: candidate.head,
    entry: resolve(v['candidate-entry']), label: 'candidate', cellIds })
  const referenceIdentity = `yaml@${referencePkg.package.version}:${hashFile(referenceEntry).sha256}`
  const referenceBare = spawnWorker({ kind: 'bare-check', workerId: 'yaml-reference-bare-provider', expectedHead: referenceIdentity,
    entry: referenceEntry, label: 'reference', cellIds })
  const before = candidateArtifactHashes(resolve(v['candidate-entry']))
  const serverBefore = serverArtifactHashes(resolve(v['server-root']))
  const candidateWorker = spawnWorker({ kind: 'server-check', workerId: 'source302-actual-server', expectedHead: candidate.head,
    entry: resolve(v['candidate-entry']), label: 'candidate', serverRoot: resolve(v['server-root']), cellIds })
  const referenceWorker = spawnWorker({ kind: 'server-check', workerId: 'yaml-reference-actual-server', expectedHead: server.head,
    entry: referenceEntry, label: 'reference', serverRoot: resolve(v['server-root']), cellIds })
  const after = candidateArtifactHashes(resolve(v['candidate-entry']))
  const serverAfter = serverArtifactHashes(resolve(v['server-root']))
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('candidate built artifacts changed during functional checking')
  if (JSON.stringify(serverBefore) !== JSON.stringify(serverAfter)) fail('compiled server or installed yaml alias changed during functional checking')
  for (const [label, worker] of [['candidate', candidateWorker], ['reference', referenceWorker]]) {
    if (worker.cells.length !== cellIds.length || cellIds.some((id) => !worker.cells.some((cell) => cell.id === id))) {
      fail(`${label} actual-server worker did not complete every planned fixture cell`)
    }
  }
  return {
    kind: 'lsp-semantic-check',
    status: 'passed',
    scoredMeasurement: false,
    functionalSmoke: true,
    compatibilityVerdict: 'not-concluded',
    candidate,
    server,
    providerArtifactBefore: before,
    providerArtifactAfter: after,
    serverArtifactsBefore: serverBefore,
    serverArtifactsAfter: serverAfter,
    declaredServerYamlDependency: '2.8.3',
    bareProviders: [candidateBare, referenceBare],
    providers: [candidateWorker, referenceWorker]
  }
}

const MEASUREMENT_PROTOCOL = Object.freeze({
  warmups: 3,
  iterationsPerCell: 25,
  oracleAndChecksumOutsideCpu: true,
  alternateProviderOrder: true,
  serialWorkers: true,
  completeOutputsRetainedForHeap: true,
  perChildRemainingBudget: true,
  outerBudgetStartsAtCliEntry: true,
  outerBudgetIncludesPreparationAndPreflight: true,
  innerBudgetStartsAfterSemanticPreflight: true,
  rawObservations: true,
  workerTimeoutMs: 60_000,
  innerBudgetMs: 49_000,
  metrics: ['cpuMs', 'wallMs', 'retainedHeapBytes', 'isolatedPeakRssBytes', 'importStartupMs']
})

function measurementEligibility(cell) {
  if (cell.policy === 'literal-default') {
    return { performanceEligible: false, reason: 'provider literal uniqueKeys defaults are not aligned' }
  }
  return { performanceEligible: true, reason: null }
}

async function prepareMeasurement(args) {
  if (args.selfCheck) fail('--self-check cannot be combined with --plan or --measure')
  const values = args.values
  for (const key of ['candidate-root', 'candidate-entry', 'candidate-head', 'server-root', 'server-head']) {
    if (!values[key]) fail(`--${args.mode} requires --${key}`)
  }
  if (resolve(values['candidate-root']) === resolve(values['server-root']) || values['candidate-head'] === values['server-head']) {
    fail(`--${args.mode} refuses self-comparison`)
  }
  if (values['candidate-head'] !== EXPECTED_CANDIDATE_HEAD || values['server-head'] !== EXPECTED_SERVER_HEAD) {
    fail('measurement participants must use the explicitly reviewed candidate and server HEADs')
  }
  const candidate = assertParticipant(resolve(values['candidate-root']), values['candidate-head'], 'candidate')
  const server = assertParticipant(resolve(values['server-root']), values['server-head'], 'server')
  const candidateProvider = packageProvenance(resolve(values['candidate-entry']), 'lightning-yaml')
  if (candidateProvider.version !== '0.1.1') fail(`candidate package version changed: ${candidateProvider.version}`)
  if (resolve(candidateProvider.root) !== resolve(candidate.root)) fail('candidate entry is outside the named candidate checkout')
  const referenceEntry = resolve(values['reference-entry'] ?? createRequire(import.meta.url).resolve('yaml'))
  const referenceProvider = packageProvenance(referenceEntry, 'yaml')
  if (referenceProvider.version !== '2.9.0') fail(`reference provider must be yaml@2.9.0, got ${referenceProvider.version}`)
  const { api: candidateApi } = await importYamlProvider(resolve(values['candidate-entry']))
  const { api: referenceApi } = await importYamlProvider(referenceEntry)
  assertYamlProvider(candidateApi, 'candidate measurement provider')
  assertYamlProvider(referenceApi, 'reference measurement provider')
  if (!values.batch) fail(`--${args.mode} requires a named --batch; implicit full matrices are disabled`)
  const cells = enumerateCells(values.batch)
  let selectedCells = cells
  if (values.cells) {
    const requested = values.cells.split(',').filter(Boolean)
    const selected = new Set(requested)
    if (selected.size !== requested.length) fail('--cells contains duplicate cell IDs')
    for (const id of selected) if (!cells.some((cell) => cell.id === id)) fail(`--cells contains an unknown planned cell ${id}`)
    selectedCells = cells.filter((cell) => selected.has(cell.id))
    if (selectedCells.length !== selected.size) fail('--cells contains duplicate cell IDs')
  }
  return {
    values, cells, selectedCells,
    candidate, server, candidateProvider, referenceProvider,
    candidateApi, referenceApi,
    referenceEntry,
    referenceIdentity: `yaml@${referenceProvider.version}:${referenceProvider.entry.sha256}`,
    participants: { candidate, server, candidateProvider, referenceProvider, declaredServerYamlDependency: '2.8.3' }
  }
}

function materializeCellSource(cell, fixtures) {
  const fixture = fixtures.find((item) => item.id === cell.fixture || cell.fixture.startsWith(`${item.id}:scaled-document-count:`))
  let source
  let expectedDocumentCount
  let transform = 'pinned corpus bytes'
  if (fixture) {
    const scaled = cell.fixture.match(/:scaled-document-count:(\d+)$/)
    if (scaled) {
      const expanded = expandDocumentStream(fixture, Number(scaled[1]))
      source = expanded.source
      expectedDocumentCount = fixture.expectedDocuments * expanded.repeatCount
      transform = expanded.transform
    } else {
      source = fixture.source
      expectedDocumentCount = fixture.expectedDocuments
    }
  } else {
    source = semanticSources[cell.fixture]
    if (typeof source !== 'string') fail(`unknown measurement fixture ${cell.fixture}`)
    expectedDocumentCount = cell.fixture === 'recovery' ? 3 : 1
    transform = 'named semantic control'
  }
  if (cell.batch === 'lsp-consumer' && cell.documentMode !== 'absent') {
    const content = source.replace(/\n+$/, '')
    if (cell.documentMode === 'nonempty-final-line') source = `${content}\n# LSP callback control`
    else if (cell.documentMode === 'empty-final-line') source = `${content}\n\n`
    else if (cell.documentMode === 'whitespace-final-line') source = `${content}\n  \n`
    transform += `; document mode ${cell.documentMode}`
  }
  return { source, transform, expectedDocumentCount, sourceSha256: sha256(source), originalFixtureSha256: fixture?.sha256 ?? null }
}

function spawnMeasurementPhase(config, timeoutMs) {
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64url')
  const child = spawnSync(process.execPath, ['--expose-gc', scriptPath, '--worker', encoded], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, LOG_TOKENS: '' }
  })
  if (child.error) throw new Error(`measurement worker ${config.workerId} failed: ${child.error.message}`)
  if (child.status !== 0) throw new Error(`measurement worker ${config.workerId} exited ${child.status}: ${(child.stderr || '').trim()}`)
  let result
  try { result = JSON.parse(child.stdout) } catch (error) { throw new Error(`measurement worker returned invalid JSON: ${error.message}`) }
  const expectedCount = config.phase === 'isolated-peak-rss' ? 1 : config.iterations
  validatePhaseResult(result, {
    workerId: config.workerId,
    head: config.expectedHead,
    cellId: config.cellId,
    participant: config.participant,
    phase: config.phase,
    inputSha256: config.inputSha256,
    resultCount: expectedCount
  })
  if (result.outputSha256 !== sha256(JSON.stringify(result.output))) throw new Error('measurement output checksum does not match its result')
  return result
}

function emptyLedger(planned) {
  return { planned: [...planned], completed: [], failed: [], pending: [...planned] }
}

async function measurePlan(args, campaignStartedAt) {
  const started = campaignStartedAt
  const budget = createCampaignBudget({
    startedAt: started,
    now: () => performance.now(),
    outerBudgetMs: MEASUREMENT_PROTOCOL.workerTimeoutMs,
    innerBudgetMs: MEASUREMENT_PROTOCOL.innerBudgetMs
  })
  const prepared = await prepareMeasurement(args)
  const { values, cells, selectedCells, candidate, server, candidateProvider, referenceProvider, referenceEntry, referenceIdentity, participants } = prepared
  const candidateArtifactsBefore = candidateArtifactHashes(resolve(values['candidate-entry']))
  const serverArtifactsBefore = serverArtifactHashes(resolve(values['server-root']))
  const phaseIdsFor = (batchCells) => batchCells.flatMap((cell) => ['candidate', 'reference'].flatMap((participant) =>
    ['cpu-wall', 'retained-heap', 'isolated-peak-rss'].map((phase) => `${cell.id}:${participant}:${phase}`)))
  const allPhaseIds = phaseIdsFor(cells)
  const selectedPhaseIds = phaseIdsFor(selectedCells)
  if (args.mode === 'plan') {
    return {
      kind: 'lsp-measurement-plan', status: 'dry-run', scoredMeasurement: false, batch: values.batch,
      participants, protocol: MEASUREMENT_PROTOCOL, plannedCellCount: cells.length,
      candidateArtifacts: candidateArtifactsBefore, serverArtifacts: serverArtifactsBefore,
      planned: cells.map((cell) => cell.id), selected: selectedCells.map((cell) => cell.id),
      completed: [], failed: [], pending: selectedCells.map((cell) => cell.id),
      plannedPhases: allPhaseIds,
      selectedPhases: selectedPhaseIds,
      notSelected: cells.filter((cell) => !selectedCells.some((selected) => selected.id === cell.id)).map((cell) => cell.id),
      eligibility: selectedCells.map((cell) => ({ id: cell.id, ...measurementEligibility(cell) })),
      note: 'Dry-run only: no parser operations were measured.'
    }
  }
  if (args.mode !== 'measure') fail('choose --measure to execute the declared measurement phases')

  const outerDeadline = started + MEASUREMENT_PROTOCOL.workerTimeoutMs
  let innerDeadline = Number.POSITIVE_INFINITY
  const rawObservations = []
  const semanticPreflight = []
  const completedPhases = new Set()
  const failedPhases = []
  const scratch = mkdtempSync(join(tmpdir(), 'lightning-yaml-lsp-measure-'))
  try {
    const fixtures = loadPinnedCorpus(repoRoot)
    let preflightComplete = true
    if (budget.remainingOuterMs() <= 0) {
      failedPhases.push({ id: 'semantic-preflight', error: 'campaign budget expired during participant preparation' })
      preflightComplete = false
    } else {
      for (const [participant, workerConfig] of [
        ['candidate', { expectedHead: candidate.head, entry: resolve(values['candidate-entry']), label: 'candidate' }],
        ['reference', { expectedHead: referenceIdentity, entry: referenceEntry, label: 'reference' }]
      ]) {
        const timeoutMs = Math.floor(budget.remainingOuterMs())
        if (timeoutMs <= 0) {
          failedPhases.push({ id: `bare-preflight:${participant}`, error: 'campaign budget expired before bare-provider preflight' })
          preflightComplete = false
          break
        }
        try {
          spawnWorker({ kind: 'bare-check', workerId: `measure-bare-preflight-${participant}`,
            ...workerConfig, cellIds: fixtures.map((fixture) => fixture.id), timeoutMs })
        } catch (error) {
          failedPhases.push({ id: `bare-preflight:${participant}`, error: error.message })
          preflightComplete = false
          break
        }
      }
    }
    if (values.batch === 'lsp-consumer' && preflightComplete) {
      const baseIds = fixtures.map((fixture) => fixture.id)
      for (const [participant, workerConfig] of [
        ['candidate', { expectedHead: candidate.head, entry: resolve(values['candidate-entry']), label: 'candidate' }],
        ['reference', { expectedHead: server.head, entry: referenceEntry, label: 'reference' }]
      ]) {
        const timeoutMs = Math.floor(budget.remainingOuterMs())
        if (timeoutMs <= 0) {
          failedPhases.push({ id: `server-preflight:${participant}`, error: 'campaign budget expired before server preflight' })
          preflightComplete = false
          break
        }
        try {
          spawnWorker({ kind: 'server-check', workerId: `measure-preflight-${participant}`, ...workerConfig,
            serverRoot: resolve(values['server-root']), cellIds: baseIds, timeoutMs })
        } catch (error) {
          failedPhases.push({ id: `server-preflight:${participant}`, error: error.message })
          preflightComplete = false
          break
        }
      }
    }
    const materializedCells = new Map()
    for (let cellIndex = 0; preflightComplete && cellIndex < selectedCells.length; cellIndex++) {
      const cell = selectedCells[cellIndex]
      if (budget.remainingOuterMs() <= 0) {
        failedPhases.push({ id: `semantic-preflight:${cell.id}`, error: 'campaign budget expired during input preparation' })
        preflightComplete = false
        break
      }
      const materialized = materializeCellSource(cell, fixtures)
      const sourceFile = join(scratch, `${cellIndex}.yaml`)
      writeFileSync(sourceFile, materialized.source)
      materializedCells.set(cell.id, { materialized, sourceFile })
      const participantOrder = cellIndex % 2 === 0 ? ['candidate', 'reference'] : ['reference', 'candidate']
      semanticCheck: for (const participant of participantOrder) {
        if (budget.remainingOuterMs() <= 0) {
          failedPhases.push({ id: `semantic-preflight:${cell.id}:${participant}`, error: 'campaign budget expired before semantic preflight' })
          preflightComplete = false
          break semanticCheck
        }
        const entry = participant === 'candidate' ? resolve(values['candidate-entry']) : referenceEntry
        const expectedHead = participant === 'candidate' ? candidate.head : referenceIdentity
        const config = {
          kind: 'measure-phase',
          workerId: `${cell.id}:${participant}:semantic-only`,
          expectedHead,
          entry,
          label: participant,
          participant,
          cellId: cell.id,
          sourceFile,
          inputSha256: materialized.sourceSha256,
          expectedDocumentCount: materialized.expectedDocumentCount,
          phase: 'semantic-only',
          policy: cell.policy,
          documentMode: cell.documentMode,
          serverMode: values.batch === 'lsp-consumer',
          serverRoot: resolve(values['server-root']),
          warmups: 0,
          iterations: 1
        }
        const remaining = outerDeadline - performance.now()
        if (remaining <= 0) {
          failedPhases.push({ id: `semantic-preflight:${cell.id}:${participant}`, error: 'campaign budget expired during semantic preflight' })
          preflightComplete = false
          break semanticCheck
        }
        try {
          const checked = spawnMeasurementPhase(config, Math.max(1, Math.floor(remaining)))
          semanticPreflight.push({ cellId: cell.id, participant, outputSha256: checked.outputSha256, input: materialized })
        } catch (error) {
          failedPhases.push({ id: `semantic-preflight:${cell.id}:${participant}`, error: error.message })
          preflightComplete = false
          break semanticCheck
        }
      }
    }

    innerDeadline = Math.min(outerDeadline, performance.now() + MEASUREMENT_PROTOCOL.innerBudgetMs)

    for (let cellIndex = 0; preflightComplete && cellIndex < selectedCells.length; cellIndex++) {
      const cell = selectedCells[cellIndex]
      const { materialized, sourceFile } = materializedCells.get(cell.id)
      const order = cellIndex % 2 === 0 ? ['candidate', 'reference'] : ['reference', 'candidate']
      for (const participant of order) {
        const entry = participant === 'candidate' ? resolve(values['candidate-entry']) : referenceEntry
        const expectedHead = participant === 'candidate' ? candidate.head : referenceIdentity
        for (const phase of ['cpu-wall', 'retained-heap', 'isolated-peak-rss']) {
          const phaseId = `${cell.id}:${participant}:${phase}`
          const remaining = Math.min(innerDeadline - performance.now(), outerDeadline - performance.now())
          if (remaining <= 0) break
          const config = {
            kind: 'measure-phase',
            workerId: phaseId,
            expectedHead,
            entry,
            label: participant,
            participant,
            cellId: cell.id,
            sourceFile,
            inputSha256: materialized.sourceSha256,
            expectedDocumentCount: materialized.expectedDocumentCount,
            phase,
            policy: cell.policy,
            documentMode: cell.documentMode,
            serverMode: values.batch === 'lsp-consumer',
            serverRoot: resolve(values['server-root']),
            warmups: MEASUREMENT_PROTOCOL.warmups,
            iterations: MEASUREMENT_PROTOCOL.iterationsPerCell
          }
          try {
            const measured = spawnMeasurementPhase(config, Math.max(1, Math.floor(remaining)))
            rawObservations.push({ ...measured, input: materialized, providerOrder: order, providerOrderIndex: order.indexOf(participant) })
            completedPhases.add(phaseId)
          } catch (error) {
            failedPhases.push({ id: phaseId, error: error.message })
          }
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

    const allPhases = selectedPhaseIds.every((id) => completedPhases.has(id))
  const completedCells = selectedCells.filter((cell) => ['candidate', 'reference'].every((participant) =>
    ['cpu-wall', 'retained-heap', 'isolated-peak-rss'].every((phase) => completedPhases.has(`${cell.id}:${participant}:${phase}`)))).map((cell) => cell.id)
  const selectedIds = selectedCells.map((cell) => cell.id)
  const cellLedger = {
    planned: cells.map((cell) => cell.id),
    completed: completedCells,
    failed: cells.filter((cell) => failedPhases.some(({ id }) => id.startsWith(`${cell.id}:`))).map((cell) => cell.id),
    pending: cells.map((cell) => cell.id).filter((id) => !completedCells.includes(id) && !failedPhases.some(({ id: failed }) => failed.startsWith(`${id}:`))),
    notSelected: cells.filter((cell) => !selectedCells.some((selected) => selected.id === cell.id)).map((cell) => cell.id)
  }
  const candidateArtifactsAfter = candidateArtifactHashes(resolve(values['candidate-entry']))
  const serverArtifactsAfter = serverArtifactHashes(resolve(values['server-root']))
  if (JSON.stringify(candidateArtifactsBefore) !== JSON.stringify(candidateArtifactsAfter)) fail('candidate artifacts changed during measurement')
  if (JSON.stringify(serverArtifactsBefore) !== JSON.stringify(serverArtifactsAfter)) fail('server artifacts or installed yaml alias changed during measurement')
  return {
    kind: 'lsp-measurement',
    status: allPhases ? 'completed' : 'incomplete',
    scoredMeasurement: true,
    batch: values.batch,
    participants,
    candidateArtifactsBefore,
    candidateArtifactsAfter,
    serverArtifactsBefore,
    serverArtifactsAfter,
    protocol: MEASUREMENT_PROTOCOL,
    plannedCellCount: cells.length,
    planned: cells.map((cell) => cell.id),
    selected: selectedIds,
    notSelected: cellLedger.notSelected,
    eligibility: selectedCells.map((cell) => ({ id: cell.id, ...measurementEligibility(cell) })),
    cells: cellLedger,
    phases: {
      planned: allPhaseIds,
      selected: selectedPhaseIds,
      completed: allPhaseIds.filter((id) => completedPhases.has(id)),
      failed: failedPhases.map(({ id }) => id),
      pending: allPhaseIds.filter((id) => !completedPhases.has(id) && !failedPhases.some((failed) => failed.id === id)),
      notSelected: allPhaseIds.filter((id) => !selectedPhaseIds.includes(id))
    },
    failedPhases,
    rawObservations,
    semanticPreflight,
    elapsedMs: performance.now() - started,
    measurementClaim: allPhases ? 'raw observations only; no optimization conclusion is made by the harness' : null
  }
}

async function main() {
  const campaignStartedAt = performance.now()
  if (process.argv[2] === '--worker') return workerMain(process.argv[3])
  const args = parseArgs(process.argv.slice(2))
  if (!args.mode) fail('choose --check, --plan or --measure explicitly')
  let output
  if (args.mode === 'measure' || args.mode === 'plan') output = await measurePlan(args, campaignStartedAt)
  else output = await actualCheck(args)
  const text = `${JSON.stringify(output, null, 2)}\n`
  if (args.values.output) {
    const outputPath = resolve(args.values.output)
    const temporary = `${outputPath}.${process.pid}.tmp`
    await import('node:fs/promises').then(({ writeFile, rename }) => writeFile(temporary, text).then(() => rename(temporary, outputPath)))
  } else process.stdout.write(text)
  if (output.status === 'incomplete') process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
