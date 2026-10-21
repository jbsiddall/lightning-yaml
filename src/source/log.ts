type HostProcess = { emitWarning?: (warning: string | Error) => void }
const hostProcess = (globalThis as typeof globalThis & { process?: HostProcess }).process

export type LogLevelId = 'silent' | 'error' | 'warn' | 'debug'

export function debug(logLevel: LogLevelId, ...messages: any[]) {
  if (logLevel === 'debug') console.log(...messages)
}

export function warn(logLevel: LogLevelId, warning: string | Error) {
  if (logLevel === 'debug' || logLevel === 'warn') {
    if (hostProcess?.emitWarning) hostProcess.emitWarning(warning)
    else console.warn(warning)
  }
}
