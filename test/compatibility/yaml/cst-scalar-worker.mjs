import { parentPort, workerData } from 'node:worker_threads'
import { CST } from '../../../src/yaml-compat.ts'

const token = {
  type: 'double-quoted-scalar',
  offset: 0,
  indent: 0,
  source: `"${' '.repeat(workerData.width)}\n${' '.repeat(workerData.width)}x"`
}
parentPort.postMessage(CST.resolveAsScalar(token).value)
