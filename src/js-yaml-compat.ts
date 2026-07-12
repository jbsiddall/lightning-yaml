/**
 * js-yaml-compat.ts — a drop-in-ish replacement for the `js-yaml` v4 public
 * API, backed by lightning-yaml's own parser (./index.ts).
 *
 * Goal: a codebase that does `import yaml from "js-yaml"` (or
 * `import { load } from "js-yaml"`) can swap the import for this module and
 * keep working, AS FAR AS lightning-yaml's current milestone allows. Full
 * fidelity is NOT the goal — see bench/conformance/compat.ts for a
 * differential report quantifying exactly how far we are, grouped by which
 * YAML construct caused the gap. Gaps are expected and intentional:
 *
 *   - `load`/`loadAll` on a construct we don't parse yet (block scalars,
 *     anchors/aliases, tags, merge keys) throw our own `NotImplementedError`
 *     — NOT a `YAMLException` — since the input isn't malformed, we just
 *     can't read it yet. This is deliberately distinguishable from a genuine
 *     syntax error (which DOES become a `YAMLException`, below), so a caller
 *     doing `catch (e) { if (e instanceof YAMLException) ... }` sees exactly
 *     the same "this document is broken" signal js-yaml would give it, and
 *     anything else (including ours-only NotImplementedError) simply isn't
 *     mistaken for that.
 *   - `dump` delegates to our `stringify`, which is a later milestone and
 *     currently always throws `NotImplementedError` — accepted-and-documented,
 *     per the task brief.
 *   - Custom schemas/tags (`Type`, `Schema`, the `*_SCHEMA` constants, and the
 *     `schema` option) are cheap stubs: they exist so imports resolve and
 *     `{ schema: CORE_SCHEMA }`-style options don't crash the call, but our
 *     parser is hardwired to YAML 1.2 core (see ./index.ts) and never
 *     branches on them.
 *
 * One thing that IS aligned rather than merely stubbed: js-yaml's `load`
 * throws on a second document in the stream (use `loadAll` instead), and our
 * `parse` throws on a second document too (see ./index.ts) — so that
 * particular divergence risk doesn't exist here.
 */

import { parse as ourParse, parseAll as ourParseAll, stringify as ourStringify, YAMLParseError, NotImplementedError } from "./index.ts";

// ---------------------------------------------------------------------------
// YAMLException — shaped like js-yaml's (name/reason/message + a cheap mark).
// ---------------------------------------------------------------------------

/**
 * Cut-down version of js-yaml's `Mark` (@types/js-yaml): the fields a
 * consumer is likely to read (`line`/`column`) are populated from our error's
 * message when we can parse one out of it; the rest are cheap placeholders
 * rather than a real re-lex of the source (js-yaml computes a `snippet` by
 * re-scanning the input around the failure — not worth reproducing for a
 * compat shim).
 */
export interface Mark {
  buffer: string;
  column: number;
  line: number;
  name: string;
  position: number;
  snippet: string;
}

/** `fail()` in ./index.ts renders positions as "<message> (line L, column C)". */
const LINE_COL_RE = /\(line (\d+), column (\d+)\)\s*$/;

function markFrom(message: string, filename: string | undefined): Mark {
  const m = LINE_COL_RE.exec(message);
  const line1 = m ? Number(m[1]) : 0;
  const col1 = m ? Number(m[2]) : 0;
  return {
    buffer: "",
    column: Math.max(0, col1 - 1),
    line: Math.max(0, line1 - 1),
    name: filename ?? "",
    position: -1,
    snippet: "",
  };
}

export class YAMLException extends Error {
  override name = "YAMLException";
  reason: string;
  mark: Mark;

  constructor(reason?: string, mark?: Mark) {
    const r = reason ?? "unknown reason";
    super(r);
    this.reason = r;
    this.mark = mark ?? { buffer: "", column: 0, line: 0, name: "", position: -1, snippet: "" };
  }

  override toString(_compact?: boolean): string {
    return `${this.name}: ${this.message}`;
  }
}

/**
 * Convert whatever `load`/`loadAll` caught into a `YAMLException`, so a
 * consumer's `catch (e) { if (e instanceof YAMLException) }` works regardless
 * of whether the failure came from our parser (`YAMLParseError`) or something
 * else. `NotImplementedError` is deliberately NOT routed through here — see
 * the module doc comment — callers of `load`/`loadAll` re-throw it unchanged.
 */
function toYAMLException(err: unknown, filename: string | undefined): YAMLException {
  if (err instanceof YAMLException) return err;
  const message = err instanceof Error ? err.message : String(err);
  const mark = err instanceof YAMLParseError ? markFrom(message, filename) : undefined;
  return new YAMLException(message, mark);
}

// ---------------------------------------------------------------------------
// Schema / Type stubs — accepted-and-ignored. Our parser is fixed to YAML 1.2
// core (./index.ts); there is no schema composition to hook these into yet.
// ---------------------------------------------------------------------------

export interface TypeConstructorOptions {
  kind?: "sequence" | "scalar" | "mapping";
  resolve?: (data: unknown) => boolean;
  construct?: (data: unknown, type?: string) => unknown;
  instanceOf?: object;
  predicate?: (data: object) => boolean;
  represent?: ((data: object) => unknown) | Record<string, (data: object) => unknown>;
  representName?: (data: object) => unknown;
  defaultStyle?: string;
  multi?: boolean;
  styleAliases?: Record<string, unknown>;
}

/** Stub mirroring js-yaml's `Type` (custom tag registration). Nothing reads it yet. */
export class Type {
  tag: string;
  kind: "sequence" | "scalar" | "mapping" | null;

  constructor(tag: string, opts: TypeConstructorOptions = {}) {
    this.tag = tag;
    this.kind = opts.kind ?? null;
  }
}

/** Stub mirroring js-yaml's `Schema` (schema composition via `.extend`). A no-op. */
export class Schema {
  constructor(_definition?: unknown) {}

  extend(_types?: unknown): Schema {
    return this;
  }
}

export const FAILSAFE_SCHEMA: Schema = new Schema();
export const JSON_SCHEMA: Schema = new Schema();
export const CORE_SCHEMA: Schema = new Schema();
export const DEFAULT_SCHEMA: Schema = new Schema();

// ---------------------------------------------------------------------------
// Options — accepted, best-effort. `filename` is honored (threaded into a
// thrown YAMLException's mark); the rest exist so option bags type-check and
// are otherwise ignored (schema/style knobs have no effect — see above).
// ---------------------------------------------------------------------------

export interface LoadOptions {
  filename?: string;
  onWarning?: (e: YAMLException) => void;
  schema?: Schema;
  json?: boolean;
  listener?: (...args: unknown[]) => void;
}

export interface DumpOptions {
  indent?: number;
  noArrayIndent?: boolean;
  skipInvalid?: boolean;
  flowLevel?: number;
  styles?: Record<string, unknown>;
  schema?: Schema;
  sortKeys?: boolean | ((a: unknown, b: unknown) => number);
  lineWidth?: number;
  noRefs?: boolean;
  noCompatMode?: boolean;
  condenseFlow?: boolean;
  quotingType?: "'" | '"';
  forceQuotes?: boolean;
  replacer?: (key: string, value: unknown) => unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * NOTE: js-yaml's `load("")` (and a few other near-empty inputs) returns
 * `undefined`, quirkily — e.g. `load(" ")` and `load("\n")` are `undefined`
 * too, but `load("  \n  \n")` and `load("# comment\n")` are `null`. That
 * inconsistency lives in js-yaml's own internal empty-document detection and
 * isn't worth reproducing bug-for-bug. We always return `null` for an empty
 * document, matching our own `parse()`'s documented contract. Tracked as a
 * known, low-impact divergence (see bench/conformance/compat.ts).
 */
export function load(input: string, opts?: LoadOptions): unknown {
  try {
    return ourParse(input);
  } catch (err) {
    if (err instanceof NotImplementedError) throw err;
    throw toYAMLException(err, opts?.filename);
  }
}

export function loadAll(input: string, iterator?: ((doc: unknown) => void) | null, opts?: LoadOptions): unknown[] | undefined {
  let docs: unknown[];
  try {
    docs = ourParseAll(input);
  } catch (err) {
    if (err instanceof NotImplementedError) throw err;
    throw toYAMLException(err, opts?.filename);
  }
  if (typeof iterator === "function") {
    for (const doc of docs) iterator(doc);
    return undefined;
  }
  return docs;
}

/** Delegates to our `stringify` — currently always throws `NotImplementedError` (a later milestone). */
export function dump(obj: unknown, _opts?: DumpOptions): string {
  return ourStringify(obj);
}

const jsYamlCompat = {
  load,
  loadAll,
  dump,
  YAMLException,
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
};

export default jsYamlCompat;
