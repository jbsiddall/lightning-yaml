/**
 * Lightning YAML — a YAML 1.2 parser and stringifier that approaches
 * `JSON.parse` / `JSON.stringify` speed and memory.
 *
 * This module is the documented public API surface. It ships only type
 * declarations and throwing stubs; the real implementation lives in the
 * package's `src/index.ts` and is wired in at build time.
 *
 * @packageDocumentation
 */

/**
 * The YAML schema used to resolve plain scalars (e.g. deciding whether
 * `no` parses as the boolean `false` or the string `"no"`).
 *
 * - `'failsafe'` — only strings, sequences, and mappings are resolved.
 *   Nothing is ever converted to a number, boolean, or null.
 * - `'json'` — the JSON-compatible subset: strings, numbers, booleans,
 *   null, sequences, and mappings, using JSON's literal spellings.
 * - `'core'` — YAML 1.2's core schema (the default). A superset of the
 *   JSON schema that also resolves common alternate spellings such as
 *   `.inf`, `.nan`, and unquoted dates.
 * - `'yaml-1.1'` — the looser YAML 1.1 schema, which additionally
 *   resolves values like `yes`/`no`/`on`/`off` as booleans and supports
 *   sexagesimal integers. Provided for interoperability with documents
 *   produced by YAML 1.1 tooling.
 *
 * @defaultValue `'core'`
 * @see {@link ParseOptions.schema}
 */
export type Schema = 'core' | 'json' | 'failsafe' | 'yaml-1.1'

/**
 * A non-fatal issue encountered while parsing a YAML document.
 *
 * Warnings are reported for constructs that are valid enough to recover
 * from but are likely mistakes — for example, a duplicate mapping key
 * (where the later value silently wins) or a deprecated escape sequence.
 * They never stop parsing; use {@link ParseOptions.onWarning} to observe
 * them.
 *
 * @see {@link ParseOptions.onWarning}
 */
export interface YAMLWarning {
  /**
   * A human-readable description of the issue, suitable for logging
   * directly.
   *
   * @example
   * ```
   * "duplicate key \"name\" in mapping (line 3, column 1)"
   * ```
   */
  message: string

  /**
   * The 1-indexed source line at which the issue was detected.
   */
  line: number

  /**
   * The 1-indexed source column at which the issue was detected.
   */
  column: number
}

/**
 * Options accepted by {@link parse} and {@link parseAll}.
 */
export interface ParseOptions {
  /**
   * The schema used to resolve plain (unquoted) scalars into JavaScript
   * values.
   *
   * @defaultValue `'core'`
   * @see {@link Schema}
   */
  schema?: Schema

  /**
   * Called once for every recoverable issue found while parsing, in
   * document order. If omitted, warnings are silently discarded — parsing
   * still succeeds.
   *
   * @param w - The warning that was detected.
   *
   * @example
   * ```ts
   * parse('foo: 1\nfoo: 2', {
   *   onWarning: (w) => console.warn(w.message),
   * })
   * // logs: duplicate key "foo" in mapping (line 2, column 1)
   * // returns: { foo: 2 }
   * ```
   */
  onWarning?: (w: YAMLWarning) => void

  /**
   * The maximum number of times an anchor may be expanded via aliases
   * (`*name`) while parsing a single document. Guards against
   * "billion laughs"-style amplification attacks built from nested
   * alias expansion.
   *
   * Set to a negative number (e.g. `-1`) to disable the limit entirely —
   * only do this for trusted input.
   *
   * @defaultValue `100`
   *
   * @example
   * ```ts
   * parse('a: &x [1, 2, 3]\nb: *x\nc: *x', { maxAliasCount: 1 })
   * // throws YAMLParseError: alias "x" expanded more than 1 time(s)
   * ```
   */
  maxAliasCount?: number
}

/**
 * Options accepted by {@link stringify}.
 */
export interface StringifyOptions {
  /**
   * The number of spaces used per indentation level in block collections.
   *
   * @defaultValue `2`
   *
   * @example
   * ```ts
   * stringify({ a: { b: 1 } }, { indent: 4 })
   * // "a:\n    b: 1\n"
   * ```
   */
  indent?: number

  /**
   * Whether mapping keys are emitted in sorted (lexicographic) order
   * rather than the value's own key insertion order.
   *
   * @defaultValue `false`
   *
   * @example
   * ```ts
   * stringify({ b: 1, a: 2 }, { sortKeys: true })
   * // "a: 2\nb: 1\n"
   * ```
   */
  sortKeys?: boolean

  /**
   * The target maximum line width, in characters, used when deciding
   * whether to fold long plain or quoted scalars across multiple lines.
   * Set to `0` to disable folding and always emit scalars on a single
   * line.
   *
   * @defaultValue `80`
   *
   * @example
   * ```ts
   * stringify({ text: 'a fairly long sentence that keeps going on' }, { lineWidth: 20 })
   * // "text: a fairly long\n  sentence that\n  keeps going on\n"
   * ```
   */
  lineWidth?: number
}

/**
 * An error thrown by {@link parse} or {@link parseAll} when the input is
 * not well-formed YAML, or otherwise violates a constraint such as
 * {@link ParseOptions.maxAliasCount}.
 *
 * @example
 * ```ts
 * try {
 *   parse('foo: [1, 2')
 * } catch (err) {
 *   if (err instanceof YAMLParseError) {
 *     console.error(`${err.message} at ${err.line}:${err.column}`)
 *     // "unexpected end of input, expected \"]\" at 1:11"
 *   }
 * }
 * ```
 */
export class YAMLParseError extends Error {
  /**
   * The 1-indexed source line at which the error was detected.
   */
  line: number

  /**
   * The 1-indexed source column at which the error was detected.
   */
  column: number

  constructor(message: string, line: number, column: number) {
    super(message)
    this.name = 'YAMLParseError'
    this.line = line
    this.column = column
  }
}

/**
 * Parses a single YAML document into a JavaScript value.
 *
 * If `source` contains multiple documents (separated by `---`), only the
 * first is returned — use {@link parseAll} to read every document in a
 * stream.
 *
 * @typeParam T - The expected shape of the parsed result. This is a type
 * assertion only; it is not validated at runtime.
 * @param source - The YAML source text to parse.
 * @param options - Parsing options. See {@link ParseOptions}.
 * @returns The JavaScript value the document represents (an object,
 * array, string, number, boolean, or `null`).
 * @throws {@link YAMLParseError}
 * If `source` is not well-formed YAML, or exceeds a configured limit
 * such as {@link ParseOptions.maxAliasCount}.
 *
 * @example
 * ```ts
 * parse('foo: bar')
 * // { foo: 'bar' }
 * ```
 *
 * @example
 * ```ts
 * interface Config { name: string; version: number }
 * parse<Config>('name: lightning-yaml\nversion: 2')
 * // { name: 'lightning-yaml', version: 2 }
 * ```
 *
 * @see {@link parseAll} to read every document in a multi-document stream.
 * @see {@link stringify} for the inverse operation.
 */
export function parse<T = unknown>(source: string, options?: ParseOptions): T {
  void source
  void options
  throw new Error('stub')
}

/**
 * Parses every document in a YAML stream, splitting on `---` document
 * markers and honoring `...` document-end markers.
 *
 * @param source - The YAML source text to parse, potentially containing
 * multiple `---`-separated documents.
 * @param options - Parsing options, applied uniformly to every document
 * in the stream. See {@link ParseOptions}.
 * @returns An array with one entry per document in the stream, in
 * document order. Returns an empty array for a source with no documents.
 * @throws {@link YAMLParseError}
 * If any document in the stream is not well-formed YAML.
 *
 * @example
 * ```ts
 * parseAll('---\na: 1\n---\nb: 2\n')
 * // [{ a: 1 }, { b: 2 }]
 * ```
 *
 * @see {@link parse} to read only the first document.
 */
export function parseAll(source: string, options?: ParseOptions): unknown[] {
  void source
  void options
  throw new Error('stub')
}

/**
 * Serializes a JavaScript value to a YAML document string.
 *
 * @param value - The value to serialize. Plain objects and arrays are
 * emitted as block mappings and sequences; strings, numbers, booleans,
 * and `null` are emitted as scalars.
 * @param options - Stringification options. See {@link StringifyOptions}.
 * @returns The serialized YAML document, always ending in a trailing
 * newline.
 * @throws {@link Error}
 * If `value` contains a construct that cannot be represented in YAML,
 * such as a `bigint`, a function, or a circular reference.
 *
 * @example
 * ```ts
 * stringify({ foo: 'bar' })
 * // "foo: bar\n"
 * ```
 *
 * @see {@link parse} for the inverse operation.
 */
export function stringify(value: unknown, options?: StringifyOptions): string {
  void value
  void options
  throw new Error('stub')
}

/**
 * Checks whether `source` is well-formed YAML without throwing or
 * returning the parsed value.
 *
 * Equivalent to calling {@link parse} in a `try`/`catch` and discarding
 * the result, but may avoid constructing intermediate values for
 * documents that fail early.
 *
 * @param source - The YAML source text to validate.
 * @param options - The same options {@link parse} would use to parse
 * `source`; validation applies the same schema and limits.
 * @returns `true` if `source` parses successfully, `false` if it raises
 * a {@link YAMLParseError}.
 *
 * @example
 * ```ts
 * isValid('foo: bar')
 * // true
 * ```
 *
 * @example
 * ```ts
 * isValid('foo: [1, 2')
 * // false
 * ```
 */
export function isValid(source: string, options?: ParseOptions): boolean {
  void source
  void options
  throw new Error('stub')
}
