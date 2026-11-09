import { deepStrictEqual, strictEqual, throws } from 'node:assert'
import { describe, it } from 'vitest'
import fc from 'fast-check'
import * as reference from 'yaml'
import { Worker } from 'node:worker_threads'
import * as compat from '../../../src/yaml-compat.ts'
import type { Document, FlowScalar, Token } from '../../../src/source/cst.ts'

const namespaceKeys = [
  'BOM', 'DOCUMENT', 'FLOW_END', 'SCALAR', 'createScalarToken', 'isCollection',
  'isScalar', 'prettyToken', 'resolveAsScalar', 'setScalarValue', 'stringify',
  'tokenType', 'visit'
].sort()

describe('public CST helper namespace', () => {
  it('exports the pinned runtime surface and preserves named/default identity', () => {
    strictEqual(compat.default.CST, compat.CST)
    deepStrictEqual(Object.keys(compat.CST).sort(), namespaceKeys)
    deepStrictEqual(Object.keys(reference.CST).sort(), namespaceKeys)
    strictEqual(compat.CST.BOM, reference.CST.BOM)
    strictEqual(compat.CST.visit.BREAK.description, reference.CST.visit.BREAK.description)
    strictEqual(typeof compat.CST.visit.itemAtPath, 'function')
    strictEqual(typeof compat.CST.visit.parentCollection, 'function')
  })

  it('reconstructs parser tokens and resolves scalar text without schema coercion', () => {
    const source = 'a: 42 # note\nquoted: "a\\n😀"\n'
    const parser = new compat.Parser()
    const tokens = [...parser.parse(source)]
    strictEqual(compat.CST.stringify(tokens[0]!), source)
    const doc = tokens[0] as Document
    const map = doc.value
    if (!map || !compat.CST.isCollection(map)) throw new Error('expected map token')
    const plain = map.items[0]?.value
    const quoted = map.items[1]?.value
    if (!plain || !quoted) throw new Error('expected scalar values')
    deepStrictEqual(compat.CST.resolveAsScalar(plain), reference.CST.resolveAsScalar(plain as never))
    strictEqual(compat.CST.resolveAsScalar(plain)?.value, '42')
    strictEqual(compat.CST.resolveAsScalar(quoted)?.value, 'a\n😀')
  })

  it('creates and mutates source tokens while retaining token identity', () => {
    const end = [
      { type: 'space', offset: 5, indent: 0, source: ' ' },
      { type: 'comment', offset: 6, indent: 0, source: '# keep' }
    ] as const
    const token = compat.CST.createScalarToken('hello', { indent: 0, end: [...end] })
    strictEqual(compat.CST.stringify(token), 'hello # keep')
    const identity = token
    compat.CST.setScalarValue(token as Token, 'updated value')
    strictEqual(token, identity)
    strictEqual(compat.CST.resolveAsScalar(token as Token)?.value, 'updated value')
    strictEqual(compat.CST.stringify(token as Token), 'updated value # keep')
    const emptyEnd: import('../../../src/source/cst.ts').SourceToken[] = []
    const noNewline = compat.CST.createScalarToken('alpha', { indent: 0, offset: 7, end: emptyEnd })
    strictEqual(noNewline.offset, 7)
    strictEqual((noNewline as FlowScalar).end, emptyEnd)
    strictEqual(compat.CST.stringify(noNewline), 'alpha')
  })

  it('matches yaml scalar construction for bounded generated styles and contexts', () => {
    const valueArb = fc.array(
      fc.constantFrom('a', ' ', ':', '#', '\\', '"', "'", '\n', '\t', '😀', '雪', '\u0000'),
      { maxLength: 20 }
    ).map(parts => parts.join(''))
    const scenarioArb = fc.record({
      value: valueArb,
      type: fc.constantFrom('BLOCK_FOLDED', 'BLOCK_LITERAL', 'PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE'),
      indent: fc.integer({ min: 0, max: 4 }),
      implicitKey: fc.boolean(),
      inFlow: fc.boolean()
    })
    fc.assert(fc.property(scenarioArb, scenario => {
      const context = {
        indent: scenario.indent,
        implicitKey: scenario.implicitKey,
        inFlow: scenario.inFlow,
        type: scenario.type as 'BLOCK_FOLDED' | 'BLOCK_LITERAL' | 'PLAIN' | 'QUOTE_DOUBLE' | 'QUOTE_SINGLE'
      }
      const actual = compat.CST.createScalarToken(scenario.value, context)
      const expected = reference.CST.createScalarToken(scenario.value, context)
      deepStrictEqual(actual, expected)
      strictEqual(compat.CST.stringify(actual), reference.CST.stringify(expected))
      const actualDiagnostics: unknown[] = []
      const expectedDiagnostics: unknown[] = []
      const actualValue = compat.CST.resolveAsScalar(actual, true, (...diagnostic) => actualDiagnostics.push(diagnostic))
      const expectedValue = reference.CST.resolveAsScalar(expected, true, (...diagnostic) => expectedDiagnostics.push(diagnostic))
      deepStrictEqual(actualValue, expectedValue)
      deepStrictEqual(actualDiagnostics, expectedDiagnostics)
    }), { numRuns: 300, seed: 20261109, path: process.env.FC_PATH })
  })

  it('matches yaml scalar mutation across generated styles and values', () => {
    const valueArb = fc.array(
      fc.constantFrom('a', ' ', ':', '#', '\\', '"', "'", '\n', '\t', '😀', '雪', '\u0000'),
      { maxLength: 16 }
    ).map(parts => parts.join(''))
    fc.assert(fc.property(valueArb, valueArb, fc.constantFrom('BLOCK_FOLDED', 'BLOCK_LITERAL', 'PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE'), (before, after, type) => {
      const options = { indent: 2, type: type as 'BLOCK_FOLDED' | 'BLOCK_LITERAL' | 'PLAIN' | 'QUOTE_DOUBLE' | 'QUOTE_SINGLE' }
      const actual = compat.CST.createScalarToken(before, options) as Token
      const expected = reference.CST.createScalarToken(before, options) as never
      compat.CST.setScalarValue(actual, after)
      reference.CST.setScalarValue(expected, after)
      deepStrictEqual(actual, expected)
      strictEqual(compat.CST.stringify(actual), reference.CST.stringify(expected))
    }), { numRuns: 300, seed: 20261109, path: process.env.FC_PATH })
  })

  it('matches yaml whitespace folding across generated LF and CRLF lines', () => {
    const whitespace = fc.array(fc.constantFrom(' ', '\t', 'a', 'b'), { maxLength: 12 }).map(parts => parts.join(''))
    fc.assert(fc.property(
      fc.array(whitespace, { minLength: 1, maxLength: 6 }),
      fc.constantFrom('\n', '\r\n'),
      (lines, newline) => {
        const token = { type: 'double-quoted-scalar' as const, offset: 0, indent: 0, source: `"${lines.join(newline)}"` }
        const actualDiagnostics: unknown[] = []
        const expectedDiagnostics: unknown[] = []
        const actual = compat.CST.resolveAsScalar(token, true, (...diagnostic) => actualDiagnostics.push(diagnostic))
        const expected = reference.CST.resolveAsScalar(token as never, true, (...diagnostic) => expectedDiagnostics.push(diagnostic))
        deepStrictEqual(actual, expected)
        deepStrictEqual(actualDiagnostics, expectedDiagnostics)
      }
    ), { numRuns: 150, seed: 20261109, path: process.env.FC_PATH })
  })

  it('finishes folding a bounded hostile whitespace scalar inside its worker deadline', async () => {
    const worker = new Worker(new URL('./cst-scalar-worker.mjs', import.meta.url), {
      workerData: { width: 250_000 },
      execArgv: ['--import', 'tsx']
    })
    const result = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        void worker.terminate()
        reject(new Error('CST whitespace folding exceeded 3 seconds'))
      }, 3000)
      worker.once('message', value => {
        clearTimeout(timer)
        resolve(value)
      })
      worker.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      worker.once('exit', code => {
        if (code !== 0) {
          clearTimeout(timer)
          reject(new Error(`CST whitespace worker exited with ${code}`))
        }
      })
    })
    strictEqual(result, ' x')
  })

  it('keeps UTF-16 ranges and comment text for quoted scalars', () => {
    const source = '"emoji 😀" # known\n'
    const doc = [...new compat.Parser().parse(source)][0] as Document
    if (!doc.value || !compat.CST.isScalar(doc.value)) throw new Error('expected scalar')
    const actual = compat.CST.resolveAsScalar(doc.value)
    strictEqual(actual?.value, 'emoji 😀')
    strictEqual(actual?.comment, ' known')
    deepStrictEqual(actual?.range, [0, 10, 19])
    deepStrictEqual(actual, reference.CST.resolveAsScalar(doc.value as never))
  })

  it('visits collection items depth-first and applies live removals', () => {
    const source = '[a, {b: c}, d]'
    const doc = [...new compat.Parser().parse(source)][0] as Document
    const referenceDoc = [...new reference.Parser().parse(source)][0] as never
    const visits: string[] = []
    let removed = false
    compat.CST.visit(doc, (item, path) => {
      visits.push(`${path.map(([side, index]) => `${side}:${index}`).join('/')}:${compat.CST.stringify(item)}`)
      if (!removed && path.length === 1 && path[0]?.[1] === 0) {
        removed = true
        return compat.CST.visit.REMOVE
      }
    })
    let referenceRemoved = false
    reference.CST.visit(referenceDoc, (_item, path) => {
      if (!referenceRemoved && path.length === 1 && path[0]?.[1] === 0) {
        referenceRemoved = true
        return reference.CST.visit.REMOVE
      }
    })
    strictEqual(visits.length, 5)
    strictEqual(compat.CST.stringify(doc), '[, {b: c}, d]')
    strictEqual(compat.CST.stringify(doc), reference.CST.stringify(referenceDoc))
    throws(() => compat.CST.visit.parentCollection(doc, []), TypeError)
    const path: Array<['key' | 'value', number]> = [['value', 99]]
    strictEqual(compat.CST.visit.itemAtPath(doc, path), undefined)

    const removeSource = '[a, b, c]'
    const removeDoc = [...new compat.Parser().parse(removeSource)][0] as Document
    const removeReference = [...new reference.Parser().parse(removeSource)][0] as never
    const removalPaths: string[] = []
    const referenceRemovalPaths: string[] = []
    compat.CST.visit(removeDoc, (_item, itemPath) => {
      if (itemPath.length === 1) {
        removalPaths.push(JSON.stringify(itemPath))
        return compat.CST.visit.REMOVE
      }
    })
    reference.CST.visit(removeReference, (_item, itemPath) => {
      if (itemPath.length === 1) {
        referenceRemovalPaths.push(JSON.stringify(itemPath))
        return reference.CST.visit.REMOVE
      }
    })
    deepStrictEqual(removalPaths, ['[["value",0]]', '[["value",0]]', '[["value",0]]'])
    deepStrictEqual(removalPaths, referenceRemovalPaths)
    if (!removeDoc.value || !compat.CST.isCollection(removeDoc.value)) throw new Error('expected sequence')
    strictEqual(removeDoc.value.items.length, 0)
    strictEqual(compat.CST.stringify(removeDoc), reference.CST.stringify(removeReference))
  })

  it('supports visitor break, skip, numeric continuation, and key/exit continuations', () => {
    const source = '[a, b, c]'
    const parsed = [...new compat.Parser().parse(source)][0] as Document
    const skipped: string[] = []
    compat.CST.visit(parsed, (_item, path) => {
      skipped.push(path.map(([, index]) => index).join('/'))
      return path.length === 0 ? compat.CST.visit.SKIP : undefined
    })
    deepStrictEqual(skipped, [''])
    const broken: string[] = []
    compat.CST.visit(parsed, (_item, path) => {
      broken.push(path.map(([, index]) => index).join('/'))
      return path.length === 1 ? compat.CST.visit.BREAK : undefined
    })
    deepStrictEqual(broken, ['', '0'])
    const continued: string[] = []
    compat.CST.visit(parsed, (_item, path) => {
      if (path.length === 1) {
        continued.push(String(path[0]?.[1]))
        if (path[0]?.[1] === 0) {
          strictEqual(Object.isFrozen(path), true)
          strictEqual(Object.isFrozen(path[0]), false)
          return 2
        }
      }
    })
    deepStrictEqual(continued, ['0', '2'])

    const pair = [...new compat.Parser().parse('{[a, b]: c}')][0] as Document
    let continuations = 0
    compat.CST.visit(pair, (item, path) => {
      if (path.length === 1 && item.key && compat.CST.isCollection(item.key)) {
        return () => {
          continuations++
          return () => {
            continuations++
          }
        }
      }
    })
    strictEqual(continuations, 2)
  })

  it('reports malformed quoted scalar diagnostics with upstream positions', () => {
    const token = { type: 'double-quoted-scalar', offset: 40, indent: 0, source: '"A\\q😀"' } as const
    const diagnostics: Array<[number, string, string]> = []
    const result = compat.CST.resolveAsScalar(token as Token, true, (offset, code, message) => {
      diagnostics.push([offset, code, message])
    })
    strictEqual(result?.value, 'A\\q😀')
    deepStrictEqual(result?.range, [40, 47, 47])
    strictEqual(diagnostics[0]?.[0], 42)
    strictEqual(diagnostics[0]?.[1], 'BAD_DQ_ESCAPE')
    deepStrictEqual(diagnostics[0]?.[0], 42)
    deepStrictEqual(result, reference.CST.resolveAsScalar(token as never, true, (offset, code, message) => {
      strictEqual(offset, 42)
      strictEqual(code, 'BAD_DQ_ESCAPE')
      strictEqual(message, diagnostics[0]?.[2])
    }))
    const lenientDiagnostics: string[] = []
    strictEqual(compat.CST.resolveAsScalar(token as Token, false, (_offset, code) => lenientDiagnostics.push(code))?.value, 'A\\q😀')
    deepStrictEqual(lenientDiagnostics, ['BAD_DQ_ESCAPE'])
    const sentinel = new Error('callback failure')
    throws(() => compat.CST.resolveAsScalar(token as Token, true, () => { throw sentinel }), error => error === sentinel)
    throws(() => compat.CST.resolveAsScalar(token as Token), (error: unknown) => {
      const err = error as { name: string; code: string; pos: [number, number] }
      strictEqual(err.name, 'YAMLParseError')
      strictEqual(err.code, 'BAD_DQ_ESCAPE')
      deepStrictEqual(err.pos, [42, 43])
      return true
    })
  })
})
