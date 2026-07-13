/**
 * js-yaml-compat.ts — a drop-in-ish replacement for the `js-yaml` v5 public
 * API, backed by lightning-yaml's own parser (./index.ts).
 *
 * Goal: a codebase that does `import { load } from "js-yaml"` can swap the
 * import for this module and keep working, AS FAR AS lightning-yaml's current
 * milestone allows. Full fidelity is NOT the goal — see
 * bench/conformance/compat.ts for a differential report quantifying exactly
 * how far we are, grouped by which YAML construct caused the gap. Gaps are
 * expected and intentional:
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
 *   - `dump` delegates to our `stringify` (implemented); options beyond the
 *     value itself are currently ignored.
 *   - Custom schemas/tags (`defineScalarTag`/`defineSequenceTag`/
 *     `defineMappingTag`, `Schema`, the `*_SCHEMA` constants, and the `schema`
 *     option) are cheap stubs: they exist so imports resolve and
 *     `{ schema: CORE_SCHEMA }`-style options don't crash the call, but our
 *     parser is hardwired to YAML 1.2 core (see ./index.ts) and never
 *     branches on them.
 *
 * One thing that IS aligned rather than merely stubbed: js-yaml's `load`
 * throws on a second document in the stream (use `loadAll` instead), and our
 * `parse` throws on a second document too (see ./index.ts) — so that
 * particular divergence risk doesn't exist here.
 *
 * v5 REWRITE NOTE: js-yaml v5 is a from-scratch rewrite (event-based AST,
 * dual ESM/CJS build with NO default export "by design" per its migration
 * guide). Its `Type` class and `DEFAULT_SCHEMA` are gone, replaced by
 * `defineScalarTag`/`defineSequenceTag`/`defineMappingTag` factory functions
 * and a `Schema.withTags(...)` composition method (`.extend()` is gone too);
 * this shim's stubs below have been renamed/reshaped to match. This module
 * still keeps its OWN default export for convenience (not present in real
 * js-yaml v5) since nothing here depends on the real package's shape for
 * that.
 */

import { parse as ourParse, parseAll as ourParseAll, stringify as ourStringify, YAMLParseError, NotImplementedError } from "./index.ts";

// ---------------------------------------------------------------------------
// YAMLException — shaped like js-yaml's (name/reason/message + a cheap mark).
// ---------------------------------------------------------------------------

/**
 * Cut-down version of js-yaml v5's `SnippetMark` (dist/js-yaml.d.ts — v5
 * bundles its own types, no more @types/js-yaml): the fields a consumer is
 * likely to read (`line`/`column`) are populated from our error's message
 * when we can parse one out of it; the rest are cheap placeholders rather
 * than a real re-lex of the source (js-yaml computes a `snippet` by
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
// Schema / tag-definition stubs — accepted-and-ignored. Our parser is fixed to
// YAML 1.2 core (./index.ts); there is no schema composition to hook these
// into yet.
//
// v5 REWRITE (vs. v4, which this shim used to mirror): js-yaml dropped the
// `Type` class and `Schema.extend()` entirely — custom tags are now defined
// via `defineScalarTag`/`defineSequenceTag`/`defineMappingTag` factory
// functions returning a plain `TagDefinition`, and `Schema` composes via
// `.withTags(...)` instead of `.extend()`. `DEFAULT_SCHEMA` is also gone with
// no direct replacement (v5's `load()` defaults to `CORE_SCHEMA` — YAML 1.2 —
// rather than v4's 1.1-flavoured `DEFAULT_SCHEMA`); the closest surviving
// legacy-1.1 bundle is the new `YAML11_SCHEMA`, which this shim now exports
// in `DEFAULT_SCHEMA`'s place.
// ---------------------------------------------------------------------------

export interface TagDefinition {
  tagName: string;
  nodeKind: "scalar" | "sequence" | "mapping";
}

/** Stub mirroring js-yaml v5's `defineScalarTag`. Nothing reads the result yet. */
export function defineScalarTag(tagName: string, _opts: Record<string, unknown> = {}): TagDefinition {
  return { tagName, nodeKind: "scalar" };
}

/** Stub mirroring js-yaml v5's `defineSequenceTag`. Nothing reads the result yet. */
export function defineSequenceTag(tagName: string, _opts: Record<string, unknown> = {}): TagDefinition {
  return { tagName, nodeKind: "sequence" };
}

/** Stub mirroring js-yaml v5's `defineMappingTag`. Nothing reads the result yet. */
export function defineMappingTag(tagName: string, _opts: Record<string, unknown> = {}): TagDefinition {
  return { tagName, nodeKind: "mapping" };
}

/** Stub mirroring js-yaml v5's `Schema` (composition via `.withTags(...)`). A no-op. */
export class Schema {
  constructor(_tags?: readonly TagDefinition[]) {}

  withTags(..._tags: unknown[]): Schema {
    return this;
  }
}

export const FAILSAFE_SCHEMA: Schema = new Schema();
export const JSON_SCHEMA: Schema = new Schema();
export const CORE_SCHEMA: Schema = new Schema();
export const YAML11_SCHEMA: Schema = new Schema();

// ---------------------------------------------------------------------------
// Options — accepted, best-effort. `filename` is honored (threaded into a
// thrown YAMLException's mark); the rest exist so option bags type-check and
// are otherwise ignored (schema/style knobs have no effect — see above).
//
// v5 REWRITE: these mirror v5's real `LoadOptions`/`DumpOptions` shapes, not
// v4's. v5 dropped `onWarning`/`listener` (load) and `styles`/`replacer`/
// `noCompatMode`/`condenseFlow`/`quotingType`/`noArrayIndent` (dump) outright;
// `noArrayIndent` became `seqNoIndent` and `quotingType: "'" | '"'` became
// `quoteStyle: "single" | "double"`.
// ---------------------------------------------------------------------------

export interface LoadOptions {
  filename?: string;
  schema?: Schema;
  json?: boolean;
  maxDepth?: number;
  maxTotalMergeKeys?: number;
  maxAliases?: number;
}

export interface DumpOptions {
  indent?: number;
  seqNoIndent?: boolean;
  seqInlineFirst?: boolean;
  skipInvalid?: boolean;
  flowLevel?: number;
  schema?: Schema;
  sortKeys?: boolean | ((a: unknown, b: unknown) => number);
  lineWidth?: number;
  noRefs?: boolean;
  quoteStyle?: "single" | "double";
  forceQuotes?: boolean;
  flowBracketPadding?: boolean;
  flowSkipCommaSpace?: boolean;
  flowSkipColonSpace?: boolean;
  quoteFlowKeys?: boolean;
  tagBeforeAnchor?: boolean;
  transform?: (documents: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * NOTE: js-yaml v4's `load("")` (and a few other near-empty inputs) returned
 * `undefined`, quirkily — e.g. `load(" ")` and `load("\n")` were `undefined`
 * too, but `load("  \n  \n")` and `load("# comment\n")` were `null`. js-yaml
 * v5 changed this again: `load("")` now THROWS a `YAMLException` ("an empty
 * stream has no document, and `load` has no output value to signal its
 * absence" — per the v5 migration guide), rather than returning anything. We
 * always return `null` for an empty document, matching our own `parse()`'s
 * documented contract, in BOTH cases — reproducing either v4's quirk or v5's
 * new throw isn't worth it for a compat shim. Tracked as a known, low-impact
 * divergence (see bench/conformance/compat.ts).
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

/** Delegates to our `stringify`. */
export function dump(obj: unknown, _opts?: DumpOptions): string {
  return ourStringify(obj);
}

const jsYamlCompat = {
  load,
  loadAll,
  dump,
  YAMLException,
  defineScalarTag,
  defineSequenceTag,
  defineMappingTag,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  YAML11_SCHEMA,
};

export default jsYamlCompat;
