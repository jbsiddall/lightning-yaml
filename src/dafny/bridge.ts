import { NativeSurface } from './generated/engine.js';

export interface DafnyParseOptions {
  strict?: boolean;
  optimizations?: {
    internStrings?: boolean;
    keyCacheMaxKb?: number;
  };
}

let adapter: InstanceType<typeof NativeSurface.Adapter> | undefined;

function getAdapter(): InstanceType<typeof NativeSurface.Adapter> {
  if (!adapter) {
    adapter = new NativeSurface.Adapter();
    adapter.__ctor();
  }
  return adapter;
}

/** Preserve the original eager core-instance setup once generated imports are initialized. */
export function initializeDafny(): void {
  getAdapter();
}

function unwrap(completion: unknown): unknown {
  const result = completion as { kind: number; value: unknown };
  if (result.kind === 1) throw result.value;
  return result.value;
}

export function parseWithDafny(text: string, options?: DafnyParseOptions): unknown {
  const surfaceAdapter = getAdapter();
  return unwrap(surfaceAdapter.Parse(text, options));
}

export function parseAllWithDafny(text: string, options?: DafnyParseOptions): unknown[] {
  const surfaceAdapter = getAdapter();
  return unwrap(surfaceAdapter.ParseAll(text, options)) as unknown[];
}

export function stringifyWithDafny(value: unknown): string {
  const surfaceAdapter = getAdapter();
  return unwrap(surfaceAdapter.Stringify(value)) as string;
}

export function exceptionToStringWithDafny(receiver: unknown): string {
  const surfaceAdapter = getAdapter();
  return unwrap(surfaceAdapter.ExceptionToString(receiver)) as string;
}

export function notImplementedMessageWithDafny(functionName: unknown): string {
  const surfaceAdapter = getAdapter();
  return unwrap(surfaceAdapter.NotImplementedMessage(functionName)) as string;
}
