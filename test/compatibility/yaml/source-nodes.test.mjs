import assert from 'node:assert/strict'
import { test } from 'vitest'
import * as yaml from 'yaml'
import fc from 'fast-check'
import { Scalar as NodeScalar, isScalarValue } from '../../../src/source/nodes/Scalar.ts'
import { Pair as NodePair } from '../../../src/source/nodes/Pair.ts'
import { YAMLMap as NodeMap } from '../../../src/source/nodes/YAMLMap.ts'
import { YAMLSeq as NodeSeq } from '../../../src/source/nodes/YAMLSeq.ts'
import { Alias as NodeAlias } from '../../../src/source/nodes/Alias.ts'
import {
  DOC,
  MAP,
  PAIR,
  SCALAR,
  SEQ,
  NODE_TYPE,
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq
} from '../../../src/source/nodes/identity.ts'
import { visit, visitAsync } from '../../../src/source/visit.ts'
import { createStringifyContext } from '../../../src/source/stringify/stringify.ts'

const referenceDocument = contents => {
  const doc = new yaml.Document()
  doc.contents = contents
  return doc
}

test('real node constructors use shared Symbol.for markers and predicates', () => {
  const scalar = new NodeScalar('x')
  const pair = new NodePair(scalar, new NodeSeq())
  const map = new NodeMap()
  map.add(pair)
  const seq = new NodeSeq()
  seq.add(map)
  const alias = new NodeAlias('a')
  const doc = referenceDocument(seq)
  assert.equal(scalar[NODE_TYPE], Symbol.for('yaml.scalar'))
  assert.equal(pair[NODE_TYPE], Symbol.for('yaml.pair'))
  assert.equal(map[NODE_TYPE], Symbol.for('yaml.map'))
  assert.equal(seq[NODE_TYPE], Symbol.for('yaml.seq'))
  assert.equal(alias[NODE_TYPE], Symbol.for('yaml.alias'))
  assert.equal(doc[NODE_TYPE], Symbol.for('yaml.document'))
  assert.ok(isScalar(scalar) && isPair(pair) && isMap(map) && isSeq(seq))
  assert.ok(isAlias(alias) && isCollection(map) && isNode(scalar) && isDocument(doc))
  assert.equal(isNode(pair), false)
  assert.equal(isScalar({ value: 'x' }), false)
  assert.ok(isScalarValue(null) && isScalarValue(1n) && !isScalarValue({}))
})

test('scalar clone copies range and preserves brands, values, and style constants', () => {
  const scalar = new NodeScalar(1n)
  scalar.range = [1, 2, 3]
  scalar.anchor = 'a'
  scalar.comment = 'kept'
  scalar.type = NodeScalar.QUOTE_SINGLE
  const clone = scalar.clone()
  assert.ok(isScalar(clone))
  assert.deepEqual(clone.range, [1, 2, 3])
  assert.notEqual(clone.range, scalar.range)
  assert.equal(clone.anchor, 'a')
  assert.equal(clone.comment, 'kept')
  clone.range[0] = 9
  assert.equal(scalar.range[0], 1)
  assert.equal(scalar.toJSON(), 1)
  assert.deepEqual(
    [NodeScalar.BLOCK_FOLDED, NodeScalar.BLOCK_LITERAL, NodeScalar.PLAIN, NodeScalar.QUOTE_DOUBLE, NodeScalar.QUOTE_SINGLE],
    [yaml.Scalar.BLOCK_FOLDED, yaml.Scalar.BLOCK_LITERAL, yaml.Scalar.PLAIN, yaml.Scalar.QUOTE_DOUBLE, yaml.Scalar.QUOTE_SINGLE]
  )
  const doc = new yaml.Document()
  for (const type of [NodeScalar.BLOCK_FOLDED, NodeScalar.BLOCK_LITERAL, NodeScalar.PLAIN, NodeScalar.QUOTE_DOUBLE, NodeScalar.QUOTE_SINGLE]) {
    const candidate = Object.assign(new NodeScalar('styled text'), { type })
    const reference = Object.assign(new yaml.Scalar('styled text'), { type })
    assert.equal(candidate.toString(createStringifyContext(doc, {})), reference.toString(createStringifyContext(doc, {})))
  }
})

test('map and sequence mutation, scalar overwrite identity, and hostile keys match reference', () => {
  const map = new NodeMap()
  const referenceMap = new yaml.YAMLMap()
  const old = new NodeScalar('old')
  const referenceOld = new yaml.Scalar('old')
  old.anchor = 'keep'
  old.comment = 'comment'
  referenceOld.anchor = 'keep'
  referenceOld.comment = 'comment'
  map.add(new NodePair(new NodeScalar('key'), old))
  referenceMap.add(new yaml.Pair(new yaml.Scalar('key'), referenceOld))
  assert.throws(() => map.add({ key: 'key', value: 'new' }), /already set/)
  assert.throws(() => referenceMap.add({ key: 'key', value: 'new' }), /already set/)
  map.add({ key: 'key', value: 'new' }, true)
  referenceMap.add({ key: 'key', value: 'new' }, true)
  assert.equal(map.get('key', true), old)
  assert.equal(old.value, 'new')
  assert.equal(old.anchor, 'keep')
  assert.equal(old.comment, 'comment')
  map.set('__proto__', 'safe')
  map.set('constructor', 'own')
  referenceMap.set('__proto__', 'safe')
  referenceMap.set('constructor', 'own')
  const output = map.toJSON()
  const referenceOutput = referenceMap.toJSON()
  assert.deepEqual(output, referenceOutput)
  assert.equal(Object.getPrototypeOf(output), Object.prototype)
  assert.equal(Object.hasOwn(output, '__proto__'), true)
  assert.equal(output.__proto__, 'safe')
  assert.equal(output.constructor, 'own')

  const seq = new NodeSeq()
  const referenceSeq = new yaml.YAMLSeq()
  seq.add('a')
  seq.add('b')
  referenceSeq.add('a')
  referenceSeq.add('b')
  assert.equal(seq.get(0), 'a')
  assert.equal(seq.has(1), true)
  seq.set(1, 'changed')
  referenceSeq.set(1, 'changed')
  assert.equal(seq.get(1), 'changed')
  assert.equal(seq.delete(0), true)
  assert.equal(referenceSeq.delete(0), true)
  assert.equal(seq.delete(9), false)
  assert.equal(referenceSeq.delete(9), false)
  assert.deepEqual(seq.toJSON(), referenceSeq.toJSON())
})

test('missing-path creation, clone(schema), and mapAsMap preserve node topology', () => {
  const doc = referenceDocument(null)
  const referenceMap = new yaml.YAMLMap(doc.schema)
  const map = new NodeMap(doc.schema)
  map.setIn(['new', 0, 'leaf'], 'value')
  referenceMap.setIn(['new', 0, 'leaf'], 'value')
  assert.equal(map.getIn(['new', 0, 'leaf']), 'value')
  assert.deepEqual(map.toJSON(), referenceMap.toJSON())
  assert.ok(isSeq(map.get('new', true)))
  const clone = map.clone(doc.schema)
  assert.notEqual(clone.items, map.items)
  assert.equal(clone.schema, doc.schema)
  assert.notEqual(clone.items[0], map.items[0])
  assert.equal(JSON.stringify(clone.toJSON()), JSON.stringify(map.toJSON()))
  const sequence = new NodeSeq(doc.schema)
  const referenceSequence = new yaml.YAMLSeq(doc.schema)
  sequence.add(new NodeScalar('x'))
  referenceSequence.add(new yaml.Scalar('x'))
  const jsDoc = referenceDocument(sequence)
  assert.deepEqual(sequence.toJS(jsDoc), ['x'])
  assert.deepEqual(sequence.toJS(jsDoc), referenceSequence.toJSON())
  const mapDoc = referenceDocument(map)
  const referenceDoc = new yaml.Document()
  referenceDoc.contents = referenceMap
  assert.deepEqual(map.toJS(mapDoc, { mapAsMap: true }), referenceDoc.toJS({ mapAsMap: true }))
})

test('inherited toJS requires branded document and runs reviver and anchor callback', () => {
  const map = new NodeMap()
  map.add(new NodePair('x', new NodeScalar(1)))
  const doc = referenceDocument(map)
  const seen = []
  assert.deepEqual(map.toJS(doc, { reviver(key, value) { seen.push(key); return value } }), { x: 1 })
  assert.ok(seen.includes('x'))
  assert.throws(() => map.toJS(), /document argument is required/)
  const facade = { contents: map, toJS() { return { x: 1 } } }
  assert.equal(isDocument(facade), false)
  assert.throws(() => map.toJS(facade), /document argument is required/)

  const anchored = new NodeScalar('v')
  anchored.anchor = 'a'
  const alias = new NodeAlias('a')
  const root = new NodeSeq()
  root.items.push(anchored, alias)
  const aliasDoc = referenceDocument(root)
  const counts = []
  assert.deepEqual(root.toJS(aliasDoc, { onAnchor: (value, count) => counts.push([value, count]) }), ['v', 'v'])
  assert.ok(counts.length > 0)
  assert.throws(() => alias.toJSON('', { anchors: new Map(), doc: aliasDoc, keep: true, mapAsMap: false, mapKeyWarned: false, maxAliasCount: 0 }), /disabled/)
})

test('aliases resolve prior anchors and contextual node writers use real reference schema', () => {
  const doc = referenceDocument(null)
  const referenceDoc = new yaml.Document()
  const target = new NodeScalar('value')
  const referenceTarget = new yaml.Scalar('value')
  target.anchor = 'a'
  referenceTarget.anchor = 'a'
  const alias = new NodeAlias('a')
  const referenceAlias = new yaml.Alias('a')
  const map = new NodeMap(doc.schema)
  map.add(new NodePair('anchor', target))
  map.add(new NodePair(Object.assign(new NodeScalar('quoted key'), { type: NodeScalar.QUOTE_SINGLE }), alias))
  const referenceMap = new yaml.YAMLMap(referenceDoc.schema)
  referenceMap.add(new yaml.Pair('anchor', referenceTarget))
  referenceMap.add(new yaml.Pair(Object.assign(new yaml.Scalar('quoted key'), { type: yaml.Scalar.QUOTE_SINGLE }), referenceAlias))
  doc.contents = map
  referenceDoc.contents = referenceMap
  assert.equal(alias.resolve(doc), target)
  const ctx = createStringifyContext(doc, {})
  const result = map.toString(ctx)
  assert.equal(result, referenceDoc.toString().trimEnd())
  assert.match(result, /quoted key/)
  assert.match(result, /\*a/)
})

test('sync and async visitors preserve traversal controls and frozen ancestry', async () => {
  const root = new NodeSeq()
  root.items.push(new NodeScalar('a'), new NodeScalar('b'), new NodeScalar('c'))
  const order = []
  visit(root, (key, node, path) => {
    if (node instanceof NodeScalar) {
      order.push([key, node.value, Object.isFrozen(path)])
      if (node.value === 'a') return visit.SKIP
    }
  })
  assert.deepEqual(order.map(x => x[1]), ['a', 'b', 'c'])
  assert.ok(order.every(x => x[2]))
  const removed = new NodeSeq()
  removed.items.push(new NodeScalar('drop'), new NodeScalar('keep'))
  visit(removed, (_key, node) => node instanceof NodeScalar && node.value === 'drop' ? visit.REMOVE : undefined)
  assert.deepEqual(removed.items.map(x => x.value), ['keep'])

  const asyncRoot = new NodeSeq()
  asyncRoot.items.push(new NodeScalar('x'), new NodeScalar('y'))
  const asyncOrder = []
  await visitAsync(asyncRoot, async (_key, node) => {
    await Promise.resolve()
    if (node instanceof NodeScalar) asyncOrder.push(node.value)
  })
  assert.deepEqual(asyncOrder, ['x', 'y'])

  const asyncControls = new NodeSeq()
  const skipped = new NodeSeq()
  skipped.items.push(new NodeScalar('hidden'))
  asyncControls.items.push(new NodeScalar('skip'), skipped, new NodeScalar('remove'), new NodeScalar('keep'))
  const asyncPathsFrozen = []
  await visitAsync(asyncControls, async (_key, node, path) => {
    await Promise.resolve()
    asyncPathsFrozen.push(Object.isFrozen(path))
    if (node === skipped) return visitAsync.SKIP
    if (node instanceof NodeScalar && node.value === 'remove') return visitAsync.REMOVE
  })
  assert.deepEqual(asyncControls.items.map(node => node.value), ['skip', undefined, 'keep'])
  assert.deepEqual(asyncControls.items[1].items.map(node => node.value), ['hidden'])
  assert.ok(asyncPathsFrozen.every(Boolean))
})

test('seeded bounded node arrays match reference YAML values', () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(fc.integer(), fc.string()), { maxLength: 12 }), values => {
      const candidate = new NodeSeq()
      const reference = new yaml.YAMLSeq()
      for (const value of values) {
        candidate.add(new NodeScalar(value))
        reference.add(new yaml.Scalar(value))
      }
      assert.deepEqual(candidate.toJSON(), reference.toJSON())
    }),
    { seed: 20261112, numRuns: 60 }
  )
})
