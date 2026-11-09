import { parentPort, workerData } from 'node:worker_threads'
import { tsImport } from 'tsx/esm/api'

const { CST } = await tsImport('../../../src/yaml-compat.ts', import.meta.url)

const token = {
  type: 'double-quoted-scalar',
  offset: 0,
  indent: 0,
  source: `"${' '.repeat(workerData.width)}\n${' '.repeat(workerData.width)}x"`
}
parentPort.postMessage(CST.resolveAsScalar(token).value)
