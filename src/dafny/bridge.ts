import { DafnyCore, Serializer } from './generated/engine.js';

export interface DafnyParseOptions {
  strict?: boolean;
  optimizations?: {
    internStrings?: boolean;
    keyCacheMaxKb?: number;
  };
}

const engine = new DafnyCore.Engine();
engine.__ctor();
const writer = new Serializer.Writer();
writer.__ctor();

function reset(text: string, options?: DafnyParseOptions): void {
  const internValues = !!options?.optimizations?.internStrings;
  const isStrict = options?.strict === true;
  const keyCacheBudget = (options?.optimizations?.keyCacheMaxKb ?? 4096) * 1024;
  engine.Reset(text, isStrict, internValues, keyCacheBudget);
}

export function parseWithDafny(text: string, options?: DafnyParseOptions): unknown {
  try {
    reset(text, options);
    return engine.ParseSingle();
  } finally {
    engine.EndStream();
  }
}

export function parseAllWithDafny(text: string, options?: DafnyParseOptions): unknown[] {
  try {
    reset(text, options);
    const documents = engine.ParseAll();
    if (!Array.isArray(documents)) throw new TypeError('Dafny parseAll returned a non-array value');
    return documents as unknown[];
  } finally {
    engine.EndStream();
  }
}

export function stringifyWithDafny(value: unknown): string {
  const text = writer.Stringify(value);
  if (typeof text !== 'string') throw new TypeError('Dafny stringify returned a non-string value');
  return text;
}
