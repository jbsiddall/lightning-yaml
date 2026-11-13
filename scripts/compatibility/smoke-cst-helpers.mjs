import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as esm from 'lightning-yaml/yaml'

const keys = [
  'BOM', 'DOCUMENT', 'FLOW_END', 'SCALAR', 'createScalarToken', 'isCollection',
  'isScalar', 'prettyToken', 'resolveAsScalar', 'setScalarValue', 'stringify',
  'tokenType', 'visit'
].sort()
const require = createRequire(import.meta.url)
const cjs = require('lightning-yaml/yaml')

for (const api of [esm, cjs]) {
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
}

console.log('built yaml CST ESM + CJS smoke test passed')
