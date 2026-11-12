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

const capture = fn => {
  try {
    return { status: 'return', value: fn() }
  } catch (error) {
    return { status: 'throw', name: error.name, message: error.message }
  }
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

test('alias limits match the reference for zero, finite, default, and unlimited counts', () => {
  const makeGraph = (Scalar, Seq, Alias) => {
    const anchor = new Scalar('shared')
    anchor.anchor = 'a'
    const root = new Seq()
    root.items.push(anchor, new Alias('a'), new Alias('a'))
    return { root, doc: referenceDocument(root) }
  }
  const candidate = makeGraph(NodeScalar, NodeSeq, NodeAlias)
  const reference = makeGraph(yaml.Scalar, yaml.YAMLSeq, yaml.Alias)
  for (const maxAliasCount of [0, 1, 2, 3, undefined, -1]) {
    const options = maxAliasCount === undefined ? {} : { maxAliasCount }
    const getResult = (root, doc) => capture(() => {
      const anchorEvents = []
      const value = root.toJS(doc, {
        ...options,
        onAnchor: (result, count) => anchorEvents.push([result, count])
      })
      return {
        values: value,
        sharesAnchor: value[0] === value[1] && value[1] === value[2],
        anchorEvents
      }
    })
    const actual = getResult(candidate.root, candidate.doc)
    const expected = getResult(reference.root, reference.doc)
    assert.equal(actual.status, expected.status, `maxAliasCount=${maxAliasCount}`)
    if (actual.status === 'throw') {
      assert.deepEqual(
        { name: actual.name, message: actual.message },
        { name: expected.name, message: expected.message },
        `maxAliasCount=${maxAliasCount}`
      )
    } else {
      assert.deepEqual(actual.value, expected.value, `maxAliasCount=${maxAliasCount}`)
      assert.equal(actual.value.sharesAnchor, true)
    }
  }
})

test('alias resolution uses the last prior duplicate anchor and rejects unresolved aliases', () => {
  const resolveCases = (Scalar, Seq, Alias) => {
    const first = new Scalar('first')
    first.anchor = 'dup'
    const second = new Scalar('second')
    second.anchor = 'dup'
    const before = new Alias('dup')
    const between = new Alias('dup')
    const after = new Alias('dup')
    const root = new Seq()
    root.items.push(before, first, between, second, after)
    const doc = referenceDocument(root)
    return {
      resolution: [before, between, after].map(alias => {
        const resolved = alias.resolve(doc)
        return resolved === first ? 'first' : resolved === second ? 'second' : null
      }),
      unresolved: capture(() =>
        new Alias('missing').toJSON('', {
          anchors: new Map(),
          doc,
          keep: true,
          mapAsMap: false,
          mapKeyWarned: false,
          maxAliasCount: 100
        })
      )
    }
  }
  const actual = resolveCases(NodeScalar, NodeSeq, NodeAlias)
  const expected = resolveCases(yaml.Scalar, yaml.YAMLSeq, yaml.Alias)
  assert.deepEqual(actual.resolution, [null, 'first', 'second'])
  assert.deepEqual(actual.resolution, expected.resolution)
  assert.deepEqual(actual.unresolved, expected.unresolved)
  assert.equal(actual.unresolved.status, 'throw')
  assert.equal(actual.unresolved.name, 'ReferenceError')
})

test('shared and cyclic alias conversion preserves the reference graph', () => {
  const makeSelfCycle = (Seq, Alias) => {
    const root = new Seq()
    root.anchor = 'self'
    root.items.push(new Alias('self'))
    const doc = referenceDocument(root)
    return { root, doc }
  }
  const actual = makeSelfCycle(NodeSeq, NodeAlias)
  const expected = makeSelfCycle(yaml.YAMLSeq, yaml.Alias)
  const actualValue = actual.root.toJS(actual.doc)
  const expectedValue = expected.root.toJS(expected.doc)
  assert.equal(actualValue[0], actualValue)
  assert.equal(expectedValue[0], expectedValue)
  assert.deepEqual(actualValue, expectedValue)
})

test('scalar object brands and custom toJSON values convert like the reference', () => {
  const make = Scalar => {
    const calls = []
    const value = {
      toJSON(key) {
        calls.push(key)
        return { converted: true }
      }
    }
    const scalar = new Scalar(value)
    const doc = referenceDocument(scalar)
    const output = scalar.toJS(doc)
    const converted = scalar.toJSON('field')
    return { rawIdentity: output === value, converted, calls, scalarValue: scalar.value }
  }
  const actual = make(NodeScalar)
  const expected = make(yaml.Scalar)
  assert.deepEqual(
    {
      rawIdentity: actual.rawIdentity,
      converted: actual.converted,
      calls: actual.calls
    },
    {
      rawIdentity: expected.rawIdentity,
      converted: expected.converted,
      calls: expected.calls
    }
  )
  assert.equal(actual.rawIdentity, true)
  assert.deepEqual(actual.calls, ['field'])
  assert.equal(isScalarValue(actual.scalarValue), false)
  assert.deepEqual(
    capture(() => new NodeScalar({ toJSON: 1 }).toJSON('', { keep: false })),
    capture(() => new yaml.Scalar({ toJSON: 1 }).toJSON('', { keep: false }))
  )
})

test('map and sequence key operations, failed mutations, and deep schema clones match reference', () => {
  const exerciseMap = (Map, Pair, Scalar, schema) => {
    const map = new Map(schema)
    const value = new Scalar('before')
    value.anchor = 'kept'
    value.range = [0, 6, 6]
    map.add(new Pair(new Scalar('key'), value))
    const initial = {
      get: map.get('key'),
      getNode: map.get(new Scalar('key'), true).value,
      hasWrapped: map.has(new Scalar('key')),
      missing: map.get('absent'),
      missingHas: map.has('absent')
    }
    map.set('key', 'after')
    const keptNode = map.get('key', true)
    const removedMissing = map.delete('absent')
    const removed = map.delete(new Scalar('key'))
    return {
      map,
      initial,
      kept: {
        value: keptNode.value,
        anchor: keptNode.anchor,
        range: keptNode.range
      },
      removedMissing,
      removed
    }
  }
  const schema = new yaml.Document().schema
  const actual = exerciseMap(NodeMap, NodePair, NodeScalar, schema)
  const expected = exerciseMap(yaml.YAMLMap, yaml.Pair, yaml.Scalar, schema)
  assert.deepEqual(actual.initial, expected.initial)
  assert.deepEqual(actual.kept, expected.kept)
  assert.deepEqual([actual.removedMissing, actual.removed], [false, true])
  assert.deepEqual([actual.removedMissing, actual.removed], [expected.removedMissing, expected.removed])
  assert.deepEqual(actual.map.toJSON(), expected.map.toJSON())

  const exerciseSeq = (Seq, Scalar) => {
    const seq = new Seq()
    const first = new Scalar('first')
    seq.items.push(first, 'second')
    const before = [
      seq.get('0'),
      seq.get(new Scalar(0)),
      seq.get(new Scalar(0), true) === first,
      seq.has('1'),
      seq.has(-1),
      seq.delete('8'),
      capture(() => seq.set('not-index', 'x'))
    ]
    seq.set(new Scalar('0'), 'changed')
    const after = [seq.get(0), first.value, seq.delete(new Scalar('1')), seq.toJSON()]
    return { before, after }
  }
  const actualSeq = exerciseSeq(NodeSeq, NodeScalar)
  const expectedSeq = exerciseSeq(yaml.YAMLSeq, yaml.Scalar)
  assert.deepEqual(actualSeq, expectedSeq)

  const sourceMap = new NodeMap(schema)
  const sourceSeq = new NodeSeq(schema)
  const ranged = new NodeScalar('leaf')
  ranged.range = [2, 6, 6]
  sourceSeq.add(ranged)
  sourceMap.add(new NodePair('branch', sourceSeq))
  const referenceMap = new yaml.YAMLMap(schema)
  const referenceSeq = new yaml.YAMLSeq(schema)
  const referenceRanged = new yaml.Scalar('leaf')
  referenceRanged.range = [2, 6, 6]
  referenceSeq.add(referenceRanged)
  referenceMap.add(new yaml.Pair('branch', referenceSeq))
  const replacementSchema = new yaml.Document().schema
  const cloned = sourceMap.clone(replacementSchema)
  const referenceClone = referenceMap.clone(replacementSchema)
  assert.notEqual(cloned.items, sourceMap.items)
  assert.notEqual(cloned.items[0], sourceMap.items[0])
  assert.notEqual(cloned.items[0].value.items, sourceSeq.items)
  assert.notEqual(cloned.items[0].value.items[0].range, ranged.range)
  assert.equal(cloned.schema, replacementSchema)
  assert.equal(cloned.items[0].value.schema, replacementSchema)
  assert.deepEqual(cloned.toJSON(), referenceClone.toJSON())
  assert.equal(referenceClone.schema, replacementSchema)
  assert.equal(referenceClone.items[0].value.schema, replacementSchema)
})

test('path creation and failures through missing schema or scalar nodes match reference', () => {
  const exercise = (Map, Scalar, schema) => {
    const map = new Map(schema)
    map.setIn(['new', 0, 'leaf'], 'value')
    const result = {
      json: map.toJSON(),
      found: map.getIn(['new', 0, 'leaf']),
      has: map.hasIn(['new', 0, 'leaf']),
      missingDelete: capture(() => map.deleteIn(['no', 'path'])),
      createdCollection: map.get('new', true).constructor.name,
      indexedCollection: map.getIn(['new', 0], true).constructor.name
    }
    const scalarPath = new Map(schema)
    scalarPath.set('fixed', new Scalar('text'))
    result.scalarPathError = capture(() => scalarPath.setIn(['fixed', 'child'], 'x'))
    return result
  }
  const schema = new yaml.Document().schema
  const actual = exercise(NodeMap, NodeScalar, schema)
  const expected = exercise(yaml.YAMLMap, yaml.Scalar, schema)
  assert.deepEqual(actual, expected)
  assert.equal(actual.createdCollection, 'YAMLSeq')
  assert.equal(actual.indexedCollection, 'YAMLMap')
  assert.equal(actual.found, 'value')
  assert.equal(actual.has, true)
  assert.equal(actual.missingDelete.status, 'throw')

  const noSchema = new NodeMap()
  assert.deepEqual(
    capture(() => noSchema.setIn(['missing', 0], 'x')),
    capture(() => new yaml.YAMLMap().setIn(['missing', 0], 'x'))
  )
})

test('visitors match replacement, deletion, skips, breaks, jumps, and handler precedence', async () => {
  const replacementRun = (Seq, Scalar, Pair, Map) => {
    const root = new Seq()
    root.items.push(new Scalar('old'), new Scalar('stay'))
    const document = referenceDocument(root)
    const rootReplacement = new Map()
    visit(document, (_key, node) => node === root ? rootReplacement : undefined)
    assert.equal(document.contents, rootReplacement)

    const childRoot = new Seq()
    const oldChild = new Scalar('old')
    const replacement = new Scalar('new')
    childRoot.items.push(oldChild, new Scalar('stay'))
    visit(childRoot, (_key, node) => node === oldChild ? replacement : undefined)

    const key = new Scalar('key')
    const value = new Scalar('value')
    const pair = new Pair(key, value)
    const map = new Map()
    map.add(pair)
    const newKey = new Scalar('renamed')
    const newValue = new Scalar('changed')
    visit(map, (slot, node) => {
      if (node === key && slot === 'key') return newKey
      if (node === value && slot === 'value') return newValue
    })
    return {
      replacedRoot: document.contents.toJSON(),
      childRoot: childRoot.toJSON(),
      pair: map.toJSON(),
      keyIdentity: pair.key === newKey,
      valueIdentity: pair.value === newValue
    }
  }
  const actual = replacementRun(NodeSeq, NodeScalar, NodePair, NodeMap)
  const expected = replacementRun(yaml.YAMLSeq, yaml.Scalar, yaml.Pair, yaml.YAMLMap)
  assert.deepEqual(actual, expected)
  assert.equal(actual.keyIdentity, true)
  assert.equal(actual.valueIdentity, true)

  const controlRun = (Seq, Scalar, Pair, Map, visitFn) => {
    const root = new Seq()
    const nested = new Seq()
    nested.items.push(new Scalar('hidden'))
    root.items.push(new Scalar('skip'), nested, new Scalar('remove'), new Scalar('keep'))
    const order = []
    visitFn(root, (_key, node) => {
      if (node instanceof Scalar) order.push(node.value)
      if (node === nested) return visitFn.SKIP
      if (node instanceof Scalar && node.value === 'remove') return visitFn.REMOVE
    })
    const jumpRoot = new Seq()
    jumpRoot.items.push(new Scalar('zero'), new Scalar('one'), new Scalar('two'))
    const jumps = []
    visitFn(jumpRoot, (key, node) => {
      if (node instanceof Scalar) jumps.push(node.value)
      if (key === 0) return 2
    })
    const broken = new Seq()
    broken.items.push(new Scalar('first'), new Scalar('never'))
    const brokenOrder = []
    visitFn(broken, (_key, node) => {
      if (node instanceof Scalar) brokenOrder.push(node.value)
      if (node instanceof Scalar && node.value === 'first') return visitFn.BREAK
    })
    return { order, remaining: root.toJSON(), jumps, brokenOrder }
  }
  const actualControls = controlRun(NodeSeq, NodeScalar, NodePair, NodeMap, visit)
  const expectedControls = controlRun(yaml.YAMLSeq, yaml.Scalar, yaml.Pair, yaml.YAMLMap, yaml.visit)
  assert.deepEqual(actualControls, expectedControls)
  assert.deepEqual(actualControls.order, ['skip', 'remove', 'keep'])
  assert.deepEqual(actualControls.jumps, ['zero', 'two'])
  assert.deepEqual(actualControls.brokenOrder, ['first'])

  const precedence = (Scalar, Seq, visitFn) => {
    const seq = new Seq()
    seq.add(new Scalar('x'))
    const calls = []
    visitFn(seq, {
      Node: (_key, node) => calls.push(`Node:${node.constructor.name}`),
      Value: (_key, node) => calls.push(`Value:${node.constructor.name}`),
      Collection: (_key, node) => calls.push(`Collection:${node.constructor.name}`),
      Seq: (_key, node) => calls.push(`Seq:${node.constructor.name}`),
      Scalar: (_key, node) => calls.push(`Scalar:${node.value}`)
    })
    return calls
  }
  assert.deepEqual(precedence(NodeScalar, NodeSeq, visit), precedence(yaml.Scalar, yaml.YAMLSeq, yaml.visit))
  assert.deepEqual(precedence(NodeScalar, NodeSeq, visit), ['Seq:YAMLSeq', 'Scalar:x'])

  const asyncPrecedence = async (Scalar, Seq, visitAsyncFn) => {
    const seq = new Seq()
    seq.add(new Scalar('x'))
    const calls = []
    await visitAsyncFn(seq, {
      Node: async (_key, node) => calls.push(`Node:${node.constructor.name}`),
      Value: async (_key, node) => calls.push(`Value:${node.constructor.name}`),
      Collection: async (_key, node) => calls.push(`Collection:${node.constructor.name}`),
      Seq: async (_key, node) => calls.push(`Seq:${node.constructor.name}`),
      Scalar: async (_key, node) => calls.push(`Scalar:${node.value}`)
    })
    return calls
  }
  assert.deepEqual(
    await asyncPrecedence(NodeScalar, NodeSeq, visitAsync),
    await asyncPrecedence(yaml.Scalar, yaml.YAMLSeq, yaml.visitAsync)
  )
  assert.deepEqual(
    await asyncPrecedence(NodeScalar, NodeSeq, visitAsync),
    ['Seq:YAMLSeq', 'Scalar:x']
  )

  const asyncVisit = async (Seq, Scalar, visitAsyncFn) => {
    const root = new Seq()
    root.items.push(new Scalar('first'), new Scalar('skip'), new Scalar('last'))
    const order = []
    await visitAsyncFn(root, async (key, node) => {
      await Promise.resolve()
      if (node instanceof Scalar) order.push(node.value)
      if (key === 0) return 2
      if (node instanceof Scalar && node.value === 'skip') return visitAsyncFn.BREAK
    })
    return order
  }
  assert.deepEqual(
    await asyncVisit(NodeSeq, NodeScalar, visitAsync),
    await asyncVisit(yaml.YAMLSeq, yaml.Scalar, yaml.visitAsync)
  )
})

test('sync and async visitors remove root and Pair slots and replace root, item, key, and value nodes', async () => {
  const run = async (Seq, Scalar, Pair, Map, visitFn, asyncMode) => {
    const apply = visitFn
    const callback = fn => asyncMode ? async (...args) => fn(...args) : fn
    const removedDoc = referenceDocument(new Scalar('root'))
    await apply(removedDoc, callback((_key, node) => node instanceof Scalar ? visitFn.REMOVE : undefined))
    const removedKeyPair = new Pair(new Scalar('key'), new Scalar('value'))
    const removedValuePair = new Pair(new Scalar('key'), new Scalar('value'))
    const mapForKey = new Map()
    mapForKey.add(removedKeyPair)
    const mapForValue = new Map()
    mapForValue.add(removedValuePair)
    await apply(
      mapForKey,
      callback((_key, node) =>
        node instanceof Scalar && node.value === 'key' ? visitFn.REMOVE : undefined
      )
    )
    await apply(
      mapForValue,
      callback((_key, node) =>
        node instanceof Scalar && node.value === 'value' ? visitFn.REMOVE : undefined
      )
    )

    const doc = referenceDocument(new Scalar('old-root'))
    const rootReplacement = new Map()
    const replacement = new Scalar('new-item')
    await apply(doc, callback((_key, node) => {
      if (node.value === 'old-root') return rootReplacement
    }))
    const seq = new Seq()
    const oldItem = new Scalar('old-item')
    seq.items.push(oldItem)
    await apply(seq, callback((_key, node) => node === oldItem ? replacement : undefined))
    const key = new Scalar('old-key')
    const value = new Scalar('old-value')
    const pair = new Pair(key, value)
    const pairMap = new Map()
    pairMap.add(pair)
    await apply(pairMap, callback((slot, node) => {
      if (node === key && slot === 'key') return new Scalar('new-key')
      if (node === value && slot === 'value') return new Scalar('new-value')
    }))
    return {
      removedRoot: removedDoc.contents,
      removedKey: removedKeyPair.key,
      removedValue: removedValuePair.value,
      rootReplacement: doc.contents.toJSON(),
      itemReplacement: seq.toJSON(),
      pairReplacement: pairMap.toJSON()
    }
  }
  for (const [visitFn, asyncMode] of [[visit, false], [visitAsync, true]]) {
    const actual = await run(NodeSeq, NodeScalar, NodePair, NodeMap, visitFn, asyncMode)
    const expectedVisitor = asyncMode ? yaml.visitAsync : yaml.visit
    const expected = await run(
      yaml.YAMLSeq,
      yaml.Scalar,
      yaml.Pair,
      yaml.YAMLMap,
      expectedVisitor,
      asyncMode
    )
    assert.deepEqual(actual, expected)
    assert.equal(actual.removedRoot, null)
    assert.equal(actual.removedKey, null)
    assert.equal(actual.removedValue, null)
    assert.deepEqual(actual.itemReplacement, ['new-item'])
    assert.deepEqual(actual.pairReplacement, { 'new-key': 'new-value' })
  }
})

test('async visitor awaits controls and matches skip, break, removal, and numeric jumps', async () => {
  const exercise = async (Seq, Scalar, visitAsyncFn) => {
    const root = new Seq()
    const nested = new Seq()
    nested.add(new Scalar('hidden'))
    root.items.push(nested, new Scalar('remove'), new Scalar('keep'))
    const seen = []
    await visitAsyncFn(root, async (key, node) => {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (node instanceof Scalar) seen.push(node.value)
      if (node === nested) return visitAsyncFn.SKIP
      if (node instanceof Scalar && node.value === 'remove') return visitAsyncFn.REMOVE
    })

    const broken = new Seq()
    broken.items.push(new Scalar('first'), new Scalar('never'))
    const breakSeen = []
    await visitAsyncFn(broken, async (_key, node) => {
      await Promise.resolve()
      if (node instanceof Scalar) breakSeen.push(node.value)
      if (node instanceof Scalar && node.value === 'first') return visitAsyncFn.BREAK
    })

    const jumped = new Seq()
    jumped.items.push(new Scalar('zero'), new Scalar('one'), new Scalar('two'))
    const jumpSeen = []
    await visitAsyncFn(jumped, async (key, node) => {
      await Promise.resolve()
      if (node instanceof Scalar) jumpSeen.push(node.value)
      if (key === 0) return 2
    })
    return { seen, remaining: root.toJSON(), breakSeen, broken: broken.toJSON(), jumpSeen }
  }
  const actual = await exercise(NodeSeq, NodeScalar, visitAsync)
  const expected = await exercise(yaml.YAMLSeq, yaml.Scalar, yaml.visitAsync)
  assert.deepEqual(actual, expected)
  assert.deepEqual(actual.seen, ['remove', 'keep'])
  assert.deepEqual(actual.remaining, [['hidden'], 'keep'])
  assert.deepEqual(actual.breakSeen, ['first'])
  assert.deepEqual(actual.jumpSeen, ['zero', 'two'])
})
