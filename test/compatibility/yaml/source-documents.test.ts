import { test } from 'vitest'
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert'
import * as reference from 'yaml'
import { Composer } from '../../../src/source/compose/composer.ts'
import { Parser } from '../../../src/source/parser.ts'
import { Document } from '../../../src/source/doc/Document.ts'
import { Schema } from '../../../src/source/schema/Schema.ts'
import { Scalar } from '../../../src/source/nodes/Scalar.ts'
import { Alias } from '../../../src/source/nodes/Alias.ts'
import { YAMLMap } from '../../../src/source/nodes/YAMLMap.ts'
import { YAMLSeq } from '../../../src/source/nodes/YAMLSeq.ts'
import { Document as PublicDocument, parseDocument } from '../../../src/yaml-compat.ts'

function parse(source: string, options: ConstructorParameters<typeof Composer>[0] = {}) {
  const tokens = [...new Parser().parse(source)]
  const docs = [...new Composer(options).compose(tokens, true, source.length)]
  return { tokens, docs }
}

test('local parser and composer produce source-aware native documents', () => {
  const source = '# lead\r\n---\r\nname: "😀"\r\nitems: &items [one, two]\r\ncopy: *items\r\n'
  const { tokens, docs } = parse(source, { keepSourceTokens: true })
  const doc = docs[0]
  ok(doc instanceof Document)
  ok(doc.schema instanceof Schema)
  ok(doc.contents instanceof YAMLMap)
  ok(doc.errors instanceof Array)
  ok(doc.warnings instanceof Array)
  strictEqual(doc.errors.length, 0)
  strictEqual(doc.warnings.length, 0)
  deepStrictEqual(doc.range, [source.indexOf('---'), source.length, source.length])
  const quoted = doc.contents.items.find(pair => pair.key?.toString() === 'name')?.value
  ok(quoted instanceof Scalar)
  strictEqual(quoted.range[0], source.indexOf('"😀"'))
  strictEqual(source.slice(quoted.range[0], quoted.range[1]), '"😀"')
  const seqPair = doc.contents.items.find(pair => pair.key?.toString() === 'items')
  ok(seqPair?.value instanceof YAMLSeq)
  ok(seqPair.value.srcToken)
  const sourceDocument = tokens.find(token => token.type === 'document')
  ok(sourceDocument?.type === 'document' && sourceDocument.value?.type === 'block-map')
  strictEqual(seqPair.value.srcToken, sourceDocument.value.items[1]?.value)
  const { docs: withoutTokens } = parse(source)
  ok(withoutTokens[0]?.contents instanceof YAMLMap)
  strictEqual(withoutTokens[0].contents.items.some(pair => pair.value?.srcToken), false)
  const projected = doc.toJS()
  const oracle = reference.parseDocument(source, { uniqueKeys: false }).toJS()
  deepStrictEqual(projected, oracle)
})

test('aliases preserve identity and conversion limits', () => {
  const { docs } = parse('root: &root { child: [1, 2] }\ncopy: *root\n')
  const doc = docs[0]!
  const result = doc.toJS({ maxAliasCount: 10 }) as Record<string, unknown>
  strictEqual(result.root, result.copy)
  const alias = doc.contents instanceof YAMLMap
    ? doc.contents.items.find(pair => pair.key?.toString() === 'copy')?.value
    : undefined
  ok(alias instanceof Alias)
  strictEqual(alias.resolve(doc), doc.contents instanceof YAMLMap ? doc.contents.items.find(pair => pair.key?.toString() === 'root')?.value : undefined)
  throws(() => doc.toJS({ maxAliasCount: 0 }), /Alias resolution is disabled/)
  const limited = doc.toJS({ maxAliasCount: 10 }) as Record<string, unknown>
  strictEqual(limited.root, limited.copy)
  const anchors: Array<[unknown, number]> = []
  const asMap = doc.toJS({ mapAsMap: true, maxAliasCount: 10, onAnchor: (value, count) => anchors.push([value, count]) })
  ok(asMap instanceof Map)
  strictEqual(anchors.length, 1)
  const revived = doc.toJS({ maxAliasCount: 10, reviver: (_key, value) => typeof value === 'number' ? value + 1 : value }) as Record<string, { child: number[] }>
  deepStrictEqual(revived.root.child, [3, 4])
  const cycleDoc = parse('self: &self { next: *self }\n').docs[0]!
  const cycle = cycleDoc.toJS({ maxAliasCount: 10 }) as Record<string, Record<string, unknown>>
  strictEqual(cycle.self, cycle.self.next)
})

test('documents mutate, clone and stringify through the native owner', () => {
  const { docs } = parse('a: { b: 1 }\nlist: [x, y]\n')
  const original = docs[0]!
  original.setIn(['a', 'b'], 2)
  original.setIn(['a', 'c'], 'new')
  original.addIn(['list'], 'z')
  original.deleteIn(['list', 0])
  const clone = original.clone()
  clone.setIn(['a', 'b'], 3)
  deepStrictEqual(original.toJS(), { a: { b: 2, c: 'new' }, list: ['y', 'z'] })
  deepStrictEqual(clone.toJS(), { a: { b: 3, c: 'new' }, list: ['y', 'z'] })
  ok(clone.schema instanceof Schema)
  ok(clone.range !== original.range)
  deepStrictEqual(clone.range, original.range)
  const emitted = clone.toString()
  deepStrictEqual(parse(emitted).docs[0]?.toJS(), clone.toJS())
  const standalone = new Scalar('x')
  strictEqual(standalone.toJS(original), 'x')
  const withTokens = parse('value: { nested: [a, b] }\n', { keepSourceTokens: true }).docs[0]!
  const tokenClone = withTokens.clone()
  const originalNode = withTokens.contents instanceof YAMLMap ? withTokens.contents.items[0]?.value : undefined
  const clonedNode = tokenClone.contents instanceof YAMLMap ? tokenClone.contents.items[0]?.value : undefined
  ok(originalNode && clonedNode)
  strictEqual(clonedNode.srcToken, originalNode.srcToken)
  ok(clonedNode.range !== originalNode.range)
})

test('composer retains partial documents, resets diagnostics and supports empty streams', () => {
  const source = '---\nvalue: [1, 2\n---\na: "\\q"\n---\nok: true\n'
  const docs = parse(source).docs
  strictEqual(docs.length, 3)
  strictEqual(docs[0]!.errors[0]?.code, 'BAD_INDENT')
  deepStrictEqual(docs[0]!.errors[0]?.pos, [17, 18])
  ok(docs[1]!.errors.some(error => error.code === 'BAD_DQ_ESCAPE'))
  deepStrictEqual(docs[1]!.errors.find(error => error.code === 'BAD_DQ_ESCAPE')?.pos, [25, 26])
  strictEqual(docs[2]!.errors.length, 0)
  throws(() => docs[0]!.toString())
  const empty = [...new Composer().compose(new Parser().parse('# lone\n'), true, 7)]
  strictEqual(empty.length, 1)
  strictEqual(empty[0]?.commentBefore, ' lone')
  const incremental = new Composer()
  const parserTokens = [...new Parser().parse('a: 1\n')]
  const emitted = parserTokens.flatMap(token => [...incremental.next(token)])
  emitted.push(...incremental.end())
  deepStrictEqual(emitted.map(doc => doc.toJS()), parse('a: 1\n').docs.map(doc => doc.toJS()))
})

test('source document policies stay within the supported core subset', () => {
  const duplicate = parse('a: 1\na: 2\n').docs[0]!
  deepStrictEqual(duplicate.toJS(), { a: 2 })
  ok(parse('a: 1\na: 2\n', { uniqueKeys: true }).docs[0]!.errors.some(e => e.code === 'DUPLICATE_KEY'))
  deepStrictEqual(parse('base: &base {a: 1}\n<<: *base\n').docs[0]?.toJS(), { base: { a: 1 }, '<<': { a: 1 } })
  ok(parse('{[1, 2]: value}').docs[0]!.errors.length > 0)
  throws(() => new Composer({ version: '1.1' }), /YAML 1.2 only/)
  throws(() => new Composer({ schema: 'yaml-1.1' }), /core schema only/)
  throws(() => new Composer({ merge: true }), /not supported/)
  throws(() => new Composer({ compat: 'yaml-1.1' }), /not supported/)
  const custom = { tag: '!local', resolve: (value: string) => value.toUpperCase() }
  const composed = [...new Composer({ customTags: [custom] }).compose(new Parser().parse('value: !local word\n'))]
  deepStrictEqual(composed[0]?.toJS(), { value: 'WORD' })
  const repeatedTag = parse('%TAG !e! tag:example.com,2020:\n%TAG !e! tag:example.com,2021:\n---\na: !e!thing value\n').docs[0]!
  ok(repeatedTag.errors.some(error => error.code === 'BAD_DIRECTIVE'))
  const unsupportedVersion = parse('%YAML 2.0\n---\nb: 1\n').docs[0]!
  ok(unsupportedVersion.errors.some(error => error.code === 'BAD_DIRECTIVE'))
})

test('direct document construction preserves node identity and writer options', () => {
  const shared = { value: 1 }
  const doc = new Document({ first: shared, second: shared, absent: undefined }, { keepUndefined: true })
  ok(doc.contents instanceof YAMLMap)
  const pair = doc.createPair('extra', { nested: true })
  doc.contents.add(pair)
  const aliases = doc.toString()
  ok(aliases.includes('&a1'))
  ok(aliases.includes('*a1'))
  const flowed = new Document({ x: [1, 2] }, { flow: true }).toString()
  ok(flowed.includes('{'))
  const filtered = new Document({ keep: 1, drop: 2 }, (key, value) => key === 'drop' ? undefined : value)
  deepStrictEqual(filtered.toJS(), { keep: 1 })
  const styles = new Document({ plain: 'simple', quoted: 'a: b', folded: 'one two three four five six seven eight nine ten', literal: 'line one\nline two\n' })
  styles.commentBefore = 'generated comment'
  const styleText = styles.toString({ blockQuote: true, lineWidth: 18, defaultStringType: Scalar.QUOTE_DOUBLE })
  ok(styleText.includes('#generated comment'))
  deepStrictEqual(parse(styleText).docs[0]?.toJS(), styles.toJS())
  const flowText = new Document({ nested: { values: [1, 2, 3] } }, { flow: true }).toString()
  ok(flowText.includes('{ nested: { values: [ 1, 2, 3 ] } }'))
  const multiline = 'first line\n'.repeat(5000)
  const multilineDoc = new Document(multiline)
  strictEqual(parse(multilineDoc.toString()).docs[0]?.toJS(), multiline)
})

test('binary documents write only the visible bytes of each view', async () => {
  const storage = new Uint8Array([0, 1, 2, 3])
  const bufferStorage = Buffer.alloc(4)
  bufferStorage.set(storage)
  const cases = [
    { value: storage, encoded: 'AAECAw==', bytes: [0, 1, 2, 3] },
    { value: storage.subarray(1, 3), encoded: 'AQI=', bytes: [1, 2] },
    { value: storage.subarray(2, 2), encoded: '', bytes: [] },
    { value: bufferStorage.subarray(1, 3), encoded: 'AQI=', bytes: [1, 2] },
  ]
  const verify = (value: Uint8Array, encoded: string, bytes: number[], tag: 'binary' | typeof import('../../../src/source/schema/yaml-1.1/binary.ts').binary) => {
    const text = new PublicDocument(value, { customTags: [tag] }).toString()
    const decoded = parseDocument(text).toJS()
    ok(decoded instanceof Uint8Array)
    deepStrictEqual(Array.from(decoded), bytes)
    if (encoded) ok(text.includes(encoded))
  }
  for (const { value, encoded, bytes } of cases) verify(value, encoded, bytes, 'binary')
  const pinned = new reference.Document(storage.subarray(1, 3), { customTags: ['binary'] }).toString()
  ok(pinned.includes('AAECAw=='))
  deepStrictEqual(Array.from(reference.parseDocument(pinned).toJS() as Uint8Array), [0, 1, 2, 3])

  const originalBuffer = globalThis.Buffer
  Reflect.set(globalThis, 'Buffer', undefined)
  try {
    const browser = await import(
      new URL('../../../src/source/schema/yaml-1.1/binary.ts?browser-like', import.meta.url).href
    )
    for (const { value, encoded, bytes } of cases) verify(value, encoded, bytes, browser.binary)
  } finally {
    Reflect.set(globalThis, 'Buffer', originalBuffer)
  }
})
