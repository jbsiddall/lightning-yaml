/**
 * Parse options for the yaml-compat POC.
 * Mirrors eemeli/yaml v2 option names and defaults exactly.
 */

export interface ParseOptions {
  /** YAML version for tag resolution. Default '1.2'. */
  version?: '1.1' | '1.2';
  /** Reject structural anomalies when true. Default true. */
  strict?: boolean;
  /** Error on duplicate mapping keys when true; last-wins when false. Default true. */
  uniqueKeys?: boolean;
  /** Apply merge keys (<<) in toJS. Default false. */
  merge?: boolean;
  /** Accept keepSourceTokens (parsed AST identical for now; full CST = PR3). */
  keepSourceTokens?: boolean;
  /** Custom tag resolvers (simple forms: { tag, test, resolve }). */
  customTags?: CustomTag[];
  /** Line counter for offset→line/col mapping. */
  lineCounter?: LineCounterLike;
  /** Alias duplicate objects behavior. Default false. */
  aliasDuplicateObjects?: boolean;
}

export interface CustomTag {
  tag: string;
  test?: (value: string) => boolean;
  resolve: (value: string) => unknown;
  identify?: (value: unknown) => boolean;
  format?: string;
}

export interface LineCounterLike {
  addNewLine(offset: number): void;
  linePos(offset: number): { line: number; col: number };
}

/** Options not yet implemented — throw NotImplemented loudly. */
export const CUT_OPTIONS = [
  'mapAsMap',
  'intAsBigInt',
  'stringKeys',
  'reviver',
  'prettyErrors',
] as const;

export function validateOptions(opts: Record<string, unknown> | undefined): ParseOptions {
  if (!opts) return {};
  for (const key of CUT_OPTIONS) {
    if (key in opts) {
      throw new Error(`Not implemented in POC: option "${key}"`);
    }
  }
  return opts as ParseOptions;
}
