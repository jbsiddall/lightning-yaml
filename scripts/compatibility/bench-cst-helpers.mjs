#!/usr/bin/env node
// Focused ESM measurement for the CST helper milestone. No dependencies beyond Node.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const wallLimitMs = 48_000
const startedAt = performance.now()
const remainingMs = () => wallLimitMs - (performance.now() - startedAt)
const scriptPath = resolve(process.argv[1])
const repoRoot = process.cwd()
const args = process.argv.slice(2)
const candidatePath = resolve(args[0] || 'dist/yaml-compat.js')
const baselinePath = args[1] && args[1] !== '-' ? resolve(args[1]) : null
const oracleRequire = createRequire('/tmp/ly-owner-browser-benchmark-nov8/package.json')
const referencePath = resolve(args[2] || oracleRequire.resolve('yaml'))
const samplesPerCase = 3
const iterationCounts = { scalar: 2500, block: 700, flow: 700, commented: 700 }
const fixtures = {
  block: '# block fixture\nname: before\nnested:\n  - one\n  - two # tail\n',
  flow: '# flow fixture\nvalue: { first: one, second: [two, three] } # end\n',
  commented: '# header\nitems: # block\n  - key: "quoted" # inline\n    value: plain\n'
}

function fail(message) {
  throw new Error(message)
}

function fileInfo(path) {
  const bytes = readFileSync(path)
  return { path, bytes: statSync(path).size, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function runWorker(mode, label, entry, workload = '', iterations = 0) {
  const remaining = remainingMs()
  if (remaining < 1_000) fail(`wall budget exhausted before ${mode}/${label}/${workload}`)
  const timeout = Math.max(500, Math.min(10_000, Math.floor(remaining - 300)))
  const result = spawnSync(process.execPath, ['--expose-gc', scriptPath, '--worker', mode, label, entry, workload, String(iterations)], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  })
  if (result.error) fail(`${mode}/${label}/${workload} worker failed: ${result.error.message}`)
  if (result.status !== 0) fail(`${mode}/${label}/${workload} worker exited ${result.status}: ${(result.stderr || '').trim()}`)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    fail(`${mode}/${label}/${workload} worker returned invalid JSON: ${error.message}`)
  }
}

function rotate(items, offset) {
  const n = offset % items.length
  return items.slice(n).concat(items.slice(0, n))
}

async function worker() {
  const [, , , mode, label, entry, workload, iterationsText] = process.argv
  const iterations = Number(iterationsText)
  if (globalThis.gc) globalThis.gc()
  const rssBefore = process.memoryUsage().rss
  const heapBefore = process.memoryUsage().heapUsed
  const importStart = performance.now()
  const api = await import(pathToFileURL(entry).href)
  const importMs = performance.now() - importStart
  if (globalThis.gc) globalThis.gc()
  const heapAfterImport = process.memoryUsage().heapUsed
  const rssAfterImport = process.memoryUsage().rss
  const result = {
    mode,
    label,
    node: process.version,
    v8: process.versions.v8,
    importMs,
    baselineHeapBytes: heapBefore,
    importHeapDeltaBytes: heapAfterImport - heapBefore,
    baselineRssBytes: rssBefore,
    importRssDeltaBytes: rssAfterImport - rssBefore
  }
  if (mode === 'cold-import') {
    if (!api.Parser) fail(`${label}: Parser export missing`)
    result.exports = { parser: typeof api.Parser, cst: typeof api.CST }
    if (label !== 'baseline') {
      if (!api.CST) fail(`${label}: CST namespace missing`)
      const firstStart = performance.now()
      const scalar = api.CST.createScalarToken('first value', { indent: 0, offset: 0, type: 'PLAIN' })
      const tokens = [...new api.Parser().parse(fixtures.block)]
      const parsed = tokens.find((token) => token.type === 'document')
      let visited = 0
      api.CST.visit(parsed, () => { visited++ })
      const serialized = tokens.map(api.CST.stringify).join('')
      if (api.CST.resolveAsScalar(scalar)?.value !== 'first value') fail(`${label}: first scalar resolution mismatch`)
      if (serialized !== fixtures.block || visited < 3) fail(`${label}: first parser/helper workflow mismatch`)
      result.firstWorkflowMs = performance.now() - firstStart
      result.importPlusFirstWorkflowMs = performance.now() - importStart
      result.firstWorkflow = { sourceBytes: fixtures.block.length, serializedBytes: serialized.length, visitedItems: visited }
    }
  } else if (mode === 'warm') {
    if (!api.CST || !api.Parser) fail(`${label}: expected CST and Parser exports`)
    const cst = api.CST
    if (workload === 'scalar') {
      const start = performance.now()
      let sink = 0
      for (let i = 0; i < iterations; i++) {
        const token = cst.createScalarToken('before', { indent: 0, offset: i, type: 'PLAIN' })
        const before = cst.resolveAsScalar(token)
        cst.setScalarValue(token, `after-${i}`)
        const after = cst.resolveAsScalar(token)
        const serialized = cst.stringify(token)
        if (before?.value !== 'before' || after?.value !== `after-${i}` || serialized !== `after-${i}\n`) fail(`${label}: scalar workflow output mismatch`)
        sink += serialized.length + after.value.length
      }
      result.elapsedMs = performance.now() - start
      result.iterations = iterations
      result.timingRegion = 'createScalarToken + resolveAsScalar + setScalarValue + resolveAsScalar + stringify; no parsing or cloning'
      result.sink = sink
    } else {
      const source = fixtures[workload]
      if (!source) fail(`unknown workload ${workload}`)
      // Parse once before timing; each timed pass visits and serializes the same retained CST.
      const tokens = [...new api.Parser().parse(source)]
      const root = tokens.find((token) => token.type === 'document')
      const serializeFixture = () => tokens.map(cst.stringify).join('')
      if (!root || serializeFixture() !== source) fail(`${label}/${workload}: fixture serialization mismatch before timing`)
      const start = performance.now()
      let sink = 0
      let visitedTotal = 0
      for (let i = 0; i < iterations; i++) {
        let visited = 0
        cst.visit(root, () => { visited++ })
        const serialized = serializeFixture()
        if (serialized !== source || visited === 0) fail(`${label}/${workload}: visit/stringify output mismatch`)
        visitedTotal += visited
        sink += serialized.length + visited
      }
      result.elapsedMs = performance.now() - start
      result.iterations = iterations
      result.timingRegion = 'visit + stringify on a Parser-produced retained CST; parsing and setup are outside timing, no per-pass cloning'
      result.inputBytes = source.length
      result.visitedItemsPerPass = visitedTotal / iterations
      result.sink = sink
    }
  } else if (mode === 'scanner') {
    if (!api.CST) fail(`${label}: expected CST namespace`)
    const widths = workload.split(',').map(Number)
    result.scannerSamples = widths.map((width) => {
      const token = {
        type: 'double-quoted-scalar',
        offset: 0,
        indent: 0,
        source: `"${' '.repeat(width)}\n${' '.repeat(width)}x"`
      }
      const start = performance.now()
      const resolved = api.CST.resolveAsScalar(token)
      const elapsedMs = performance.now() - start
      if (resolved?.value !== ' x') fail(`${label}: whitespace fold output mismatch at ${width}`)
      return { width, sourceChars: token.source.length, elapsedMs, valueLength: resolved.value.length }
    })
  } else {
    fail(`unknown worker mode: ${mode}`)
  }
  process.stdout.write(JSON.stringify(result))
}

async function main() {
  if (process.argv[2] === '--worker') return worker()
  const entries = [{ label: 'candidate', path: candidatePath }]
  if (baselinePath) entries.push({ label: 'baseline', path: baselinePath })
  entries.push({ label: 'reference-yaml-2.9.0', path: referencePath })
  const infos = Object.fromEntries(entries.map(({ label, path }) => [label, fileInfo(path)]))
  const cold = []
  for (let sample = 0; sample < samplesPerCase; sample++) {
    // Rotate process order to reduce simple order and thermal bias.
    for (const entry of rotate(entries, sample)) cold.push({ sample: sample + 1, ...runWorker('cold-import', entry.label, entry.path) })
  }
  const scanner = [
    { label: 'candidate', sizes: '10000,50000,250000' },
    { label: 'reference-yaml-2.9.0', sizes: '1000,5000,10000' }
  ].map(({ label, sizes }) => ({ label, ...runWorker('scanner', label, entries.find((entry) => entry.label === label).path, sizes) }))
  const warm = []
  const warmEntries = entries.filter((entry) => entry.label !== 'baseline')
  for (const workload of Object.keys(iterationCounts)) {
    for (let sample = 0; sample < samplesPerCase; sample++) {
      for (const entry of rotate(warmEntries, sample)) {
        warm.push({ sample: sample + 1, workload, ...runWorker('warm', entry.label, entry.path, workload, iterationCounts[workload]) })
      }
    }
  }
  const output = {
    kind: 'focused-cst-helper-measurement',
    status: 'mechanics measurement; not a universal performance claim',
    provenance: {
      generatedAt: new Date().toISOString(),
      cwd: repoRoot,
      packageVersion: JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version,
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      entries: infos,
      referencePackage: 'yaml@2.9.0 via /tmp/ly-owner-browser-benchmark-nov8/node_modules'
    },
    design: {
      format: 'ESM only',
      wallLimitMs,
      samplesPerCase,
      coldMetrics: 'fresh subprocess baseline heap/RSS, cold ESM import latency and post-import heap/RSS deltas; candidate/reference also report first Parser + CST workflow time',
      warmTimingRegions: 'per workload below; no parsing/cloning in timed visit/stringify regions',
      workloads: iterationCounts,
      scanner: 'one candidate subprocess samples 10k/50k/250k whitespace widths; one reference subprocess samples only 1k/5k/10k to bound exposure to the known quadratic fallback; timings are local samples, not a proof of complexity',
      fixtureBytes: Object.fromEntries(Object.entries(fixtures).map(([name, source]) => [name, source.length])),
      caveat: 'Short local samples are sensitive to process startup, GC, JIT, filesystem cache, and machine load. Compare raw samples and matched work only; this does not establish universal or native-parser performance.'
    },
    coldSamples: cold,
    scannerSamples: scanner,
    warmSamples: warm,
    elapsedWallMs: performance.now() - startedAt
  }
  if (remainingMs() < 0) fail('wall budget exceeded')
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
