/**
 * Public parser and serializer facade. The YAML scanner, resolver, collection
 * handling and writer live in the generated Dafny module.
 */

import { initializeDafny, parseAllWithDafny, parseWithDafny, stringifyWithDafny } from "./dafny/bridge.ts";

initializeDafny();

export { NotImplementedError, YAMLParseError } from "./errors.ts";

/** Options for {@link parse} and {@link parseAll}. */
export interface ParseOptimizations {
  /** Intern equal scalar string values for the lifetime of a parse call. */
  internStrings?: boolean;
  /** Maximum key-cache budget in KiB; defaults to 4096. */
  keyCacheMaxKb?: number;
}

/** Options for {@link parse} and {@link parseAll}. */
export interface ParseOptions {
  /** Reject malformed block indentation that lenient parsing accepts. */
  strict?: boolean;
  /** Optional memory and CPU tradeoffs. */
  optimizations?: ParseOptimizations;
}

/** Parse one YAML document. Use {@link parseAll} for a multi-document stream. */
export function parse(text: string, options?: ParseOptions): unknown {
  return parseWithDafny(text, options);
}

/** Parse each document in a YAML stream. */
export function parseAll(text: string, options?: ParseOptions): unknown[] {
  return parseAllWithDafny(text, options);
}

/** Serialize a JavaScript value as a YAML document. */
export function stringify(value: unknown): string {
  return stringifyWithDafny(value);
}
