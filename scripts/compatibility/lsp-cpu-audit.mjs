import { createHash } from 'node:crypto'
import { classifyCpuSamples } from './lsp-diagnostics.mjs'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function readHashBoundJson(bytes, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || sha256(bytes) !== expectedSha256) throw new Error('SHA256 mismatch')
  return JSON.parse(bytes.toString())
}

// Witness tuples are deliberately local to a hash-bound profile, not a source identity classifier.
export function normalizedFrame(frame) {
  return { functionName: frame.functionName, file: frame.url.split('/').at(-1), line: frame.lineNumber, column: frame.columnNumber }
}

export function auditCpuProfile(bytes, expectedSha256, witnesses = []) {
  const profile = readHashBoundJson(bytes, expectedSha256)
  const { nodes, samples, timeDeltas, startTime, endTime } = profile
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(samples) || !samples.length) throw new Error('missing nodes/samples')
  if (!Array.isArray(timeDeltas) || samples.length !== timeDeltas.length) throw new Error('sample/delta pairing')
  if (![startTime, endTime].every(Number.isFinite) || startTime < 0 || endTime <= startTime
    || timeDeltas.some((delta) => !Number.isFinite(delta) || delta < 0)) throw new Error('invalid clock')
  const spanUs = endTime - startTime
  const deltaSumUs = timeDeltas.reduce((sum, delta) => sum + delta, 0)
  if (!Number.isFinite(deltaSumUs) || deltaSumUs > spanUs) throw new Error('invalid clock residual')
  const byId = new Map()
  const parent = new Map()
  for (const node of nodes) {
    if (!Number.isInteger(node.id) || node.id <= 0 || byId.has(node.id)) throw new Error('invalid/duplicate node id')
    const frame = node.callFrame
    if (!frame || typeof frame.functionName !== 'string' || typeof frame.url !== 'string'
      || !Number.isInteger(frame.lineNumber) || !Number.isInteger(frame.columnNumber)) throw new Error('invalid frame')
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('invalid children')
    if (node.hitCount !== undefined && (!Number.isInteger(node.hitCount) || node.hitCount < 0)) throw new Error('invalid hitCount')
    byId.set(node.id, node)
  }
  for (const node of nodes) for (const child of node.children ?? []) {
    if (!byId.has(child) || parent.has(child)) throw new Error('invalid child reference/multiple parents')
    parent.set(child, node.id)
  }
  for (const node of nodes) {
    const seen = new Set()
    for (let id = node.id; id !== undefined; id = parent.get(id)) {
      if (seen.has(id)) throw new Error('cycle in profile tree')
      seen.add(id)
    }
  }
  if (nodes.filter((node) => !parent.has(node.id)).length !== 1) throw new Error('profile must have one root')
  if (samples.some((id) => !byId.has(id))) throw new Error('invalid sample reference')
  const stacks = samples.map((id) => {
    const stack = []
    for (; id !== undefined; id = parent.get(id)) stack.push(byId.get(id))
    return stack
  })
  const legacy = classifyCpuSamples(profile)
  const legacyBySample = samples.map((id) => Object.entries(classifyCpuSamples({ ...profile, samples: [id] }).categories).find(([, count]) => count === 1)[0])
  const summarize = (indices) => ({
    samples: indices.length,
    intervalProxyUs: indices.reduce((sum, index) => sum + timeDeltas[index], 0),
    legacyCategories: indices.reduce((counts, index) => {
      const category = legacyBySample[index]
      counts[category] = (counts[category] ?? 0) + 1
      return counts
    }, {})
  })
  const sameFrame = (node, frame) => {
    const actual = normalizedFrame(node.callFrame)
    return ['functionName', 'file', 'line', 'column'].every((key) => actual[key] === frame[key])
  }
  const evidence = witnesses.map(({ label, frames }) => {
    if (typeof label !== 'string' || !Array.isArray(frames) || frames.length === 0) throw new Error('invalid witness')
    const matches = (node) => frames.some((frame) => sameFrame(node, frame))
    if (frames.some((frame) => !nodes.some((node) => sameFrame(node, frame)))) throw new Error('witness frame absent')
    return { label, frames, leaf: summarize(stacks.flatMap((stack, index) => matches(stack[0]) ? [index] : [])),
      ancestry: summarize(stacks.flatMap((stack, index) => stack.some(matches) ? [index] : [])) }
  })
  return {
    schema: 'lsp-cpu-clock-stack-audit-v1', artifactSha256: expectedSha256, sampleCount: samples.length,
    nodeHitCountSum: nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0),
    clock: { spanUs, deltaSumUs, firstObservationDeltaUs: timeDeltas[0], subsequentDeltaSumUs: deltaSumUs - timeDeltas[0],
      trailingUnassignedUs: spanUs - deltaSumUs, minDeltaUs: Math.min(...timeDeltas), maxDeltaUs: Math.max(...timeDeltas) },
    legacy, firstObservationStack: stacks[0].map((node) => normalizedFrame(node.callFrame)), witnesses: evidence
  }
}
