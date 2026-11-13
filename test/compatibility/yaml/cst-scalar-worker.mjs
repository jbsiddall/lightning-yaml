import { parentPort, workerData } from 'node:worker_threads'
import { tsImport } from 'tsx/esm/api'

let CST
if (workerData.legacyFallback) {
  const NativeRegExp = globalThis.RegExp
  globalThis.RegExp = function (pattern, flags) {
    if (String(pattern).includes('(?<!')) throw new SyntaxError('lookbehind disabled for fallback control')
    return new NativeRegExp(pattern, flags)
  }
  globalThis.RegExp.prototype = NativeRegExp.prototype
  ;({ CST } = await import('yaml'))
} else {
  ;({ CST } = await tsImport('../../../src/yaml-compat.ts', import.meta.url))
}

const token = {
  type: 'scalar',
  offset: 0,
  indent: 0,
  source: `x${' '.repeat(workerData.width)}`
}
parentPort.postMessage({ type: 'ready' })
parentPort.postMessage({ type: 'result', value: CST.resolveAsScalar(token).value })
