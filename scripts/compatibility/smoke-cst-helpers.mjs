import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as esm from 'lightning-yaml/yaml'

const keys = [
  'BOM', 'DOCUMENT', 'FLOW_END', 'SCALAR', 'createScalarToken', 'isCollection',
  'isScalar', 'prettyToken', 'resolveAsScalar', 'setScalarValue', 'stringify',
  'tokenType', 'visit'
].sort()
const publicNames = [
  'Alias', 'Composer', 'Document', 'Pair', 'Scalar', 'Schema', 'YAMLMap', 'YAMLSeq',
  'YAMLParseError', 'YAMLWarning', 'YAMLError', 'isAlias', 'isCollection', 'isDocument',
  'isMap', 'isNode', 'isPair', 'isScalar', 'isSeq', 'visit'
]
const require = createRequire(import.meta.url)
const cjs = require('lightning-yaml/yaml')

for (const api of [esm, cjs]) {
  for (const name of publicNames) {
    assert.equal(typeof api[name], 'function', `missing ${name}`)
    assert.equal(api.default[name], api[name], `default ${name} differs`)
  }
  assert.deepEqual(Object.keys(api.CST).sort(), keys)
  assert.equal(api.default.CST, api.CST)
  assert.equal(typeof api.CST.visit.BREAK, 'symbol')
  assert.equal(typeof api.CST.visit.SKIP, 'symbol')
  assert.equal(typeof api.CST.visit.REMOVE, 'symbol')
  assert.equal(typeof api.CST.visit.itemAtPath, 'function')
  assert.equal(typeof api.CST.visit.parentCollection, 'function')
  const source = 'answer: "42"\n'
  const token = [...new api.Parser().parse(source)][0]
  assert.equal(api.CST.stringify(token), source)
  assert.equal(api.CST.resolveAsScalar(token.value.items[0].value).value, '42')
  const doc = api.parseDocument('answer: 42')
  assert.ok(doc instanceof api.Document)
  assert.ok(api.isMap(doc.contents))
  assert.deepEqual(doc.toJS(), { answer: 42 })
}

console.log('built yaml document and CST ESM + CJS smoke test passed')
