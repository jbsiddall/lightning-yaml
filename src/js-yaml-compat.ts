/**
 * @packageDocumentation
 *
 * js-yaml-compat.ts — a drop-in-ish replacement for the `js-yaml` v5 public
 * API (`load`/`loadAll`/`dump`), backed by lightning-yaml's own parser
 * (./index.ts).
 *
 * This module doc block is the MASTER SOURCE for js-yaml compatibility: it is
 * published verbatim to the website's API reference (site/astro.config.mjs
 * wires this file through starlight-typedoc), so keep it accurate and up to date.
 *
 * ## Compatibility level TODAY
 *
 * **API-level, with a growing set of honoured options.** Every export and call
 * signature the real `js-yaml` exposes exists here, so code that imports
 * `load`/`loadAll`/`dump` compiles and runs unchanged. On top of that, the
 * options that matter most for migration are now wired through to the core
 * (./index.ts): on `load`/`loadAll` — `filename`, `schema` (core vs. rich
 * typing), `maxAliases`, `maxDepth`; on `dump` — `indent`, `quoteStyle`,
 * `forceQuotes`, `noRefs`, `schema`. The remaining options (`json`,
 * `sortKeys`, `lineWidth`, the flow-style knobs, `transform`, …) are still
 * accepted-and-ignored, and `maxTotalMergeKeys` is a permanent non-goal (❌
 * below) — a call that relies on one of those will still behave differently
 * from real js-yaml.
 *
 * ## Goal
 *
 * Maximise drop-in compatibility **without ever compromising the two things
 * that outrank it: YAML-1.2-spec correctness and core (./index.ts) speed.**
 * Per-option cost is therefore paid either in this shim (pre-/post-processing
 * the plain-JS value, the way the `yaml` shim's reviver already does) or behind
 * a gated core seam that leaves the options-free fast path byte-identical. An
 * option we can't yet honour should eventually FAIL LOUD, not be silently
 * ignored. We are not there yet — this file tracks the gap.
 *
 * ## Option support matrix
 *
 * `status` — `done`: honoured · `ignored`: accepted so call sites type-check but
 * has no effect (yet) · `feature`: needs a parser/dumper capability that does
 * not exist yet · ❌: a deliberate, permanent non-goal that will NOT be
 * implemented.
 *
 * ```text
 * load / loadAll (LoadOptions)
 *   filename           attach source path to error marks          done
 *   schema             core (reject !!binary/!!set/…) vs rich      done         [2]
 *   maxAliases         cap resolved aliases (billion-laughs)       done
 *   maxDepth           cap nesting depth                           done
 *   json               dup-key: last-wins (true) vs throw (false)  ignored      [1]
 *   maxTotalMergeKeys  cap `<<` merge expansion                    ❌           (YAML-1.1 merge keys; non-goal)
 *
 * dump (DumpOptions)
 *   indent             block indent width (default 2)              done
 *   quoteStyle         prefer 'single' vs "double" when quoting    done
 *   forceQuotes        always quote string values                  done         [4]
 *   noRefs             duplicate shared refs instead of &/*        done         [3]
 *   schema             core (reject Uint8Array) vs rich !!binary   done
 *   sortKeys           sort map keys on output                     ignored
 *   skipInvalid        drop functions/undefined vs emit/throw      ignored
 *   lineWidth          fold long lines                             feature      (no line folding exists)
 *   flowLevel + seqNoIndent + seqInlineFirst + flowBracketPadding  feature      (no flow-collection writer)
 *     + flowSkipCommaSpace + flowSkipColonSpace + quoteFlowKeys
 *     + tagBeforeAnchor
 *   transform          mutate documents before dump               feature       (needs a Document/AST model)
 * ```
 *
 * [1] Our default is already last-wins (= `json: true`). Worth knowing: the
 *     yaml-test-suite treats duplicate keys as VALID (case 2JQS), so
 *     throw-on-duplicate is a js-yaml-PARITY knob, NOT a spec-conformance win.
 * [2] The rich tags (`!!binary`/`!!set`/`!!omap`/`!!pairs`) resolve by DEFAULT
 *     (matching lightning-yaml's own `parse()`), unlike real js-yaml v5 whose
 *     `load` default is core and REJECTS them. Pass `schema: CORE_SCHEMA` (or
 *     `JSON_SCHEMA`/`FAILSAFE_SCHEMA`) for the strict, js-yaml-default rejection;
 *     `YAML11_SCHEMA` is the explicit rich request. Schema never changes scalar
 *     typing (`yes`/`no`/`on`/`off` stay strings — we are 1.2-only).
 * [3] `noRefs` can't just skip anchoring: the shared-reference pre-scan is also
 *     the cycle guard, so it first proves the graph acyclic (a genuine cycle
 *     throws) and only then duplicates the shared DAG nodes.
 * [4] Applies to string VALUES only — keys stay bare and non-string scalars are
 *     left un-tagged (we don't reproduce js-yaml's `1` → `!!int '1'` quirk).
 *
 * The construct-level gaps below are the current intentional simplifications
 * (a `NotImplementedError` here means "can't read this yet", not "malformed"):
 *
 *   - Parser coverage: the core is feature-complete for YAML 1.2 core — block
 *     scalars, anchors/aliases, and tags (incl. `!!binary`) all parse, so
 *     `load`/`loadAll` return values for them rather than rejecting. The one
 *     known gap is merge keys (`<<`): they are neither merged nor rejected —
 *     `<<` comes back as an ordinary key (e.g. `{ "<<": {...}, y: 2 }`), which
 *     diverges from js-yaml's merge semantics. (See the matrix above.)
 *   - Errors: a genuine syntax error surfaces as a `YAMLException` (see below),
 *     so a caller's `catch (e) { if (e instanceof YAMLException) ... }` gets the
 *     same "this document is broken" signal js-yaml gives. `load`/`loadAll` also
 *     re-throw our `NotImplementedError` unwrapped rather than mislabeling it a
 *     `YAMLException` — but that path is defensive: the current parser is
 *     complete and never throws it.
 *   - `dump` delegates to our `stringify` and threads the honoured knobs
 *     (`indent`/`quoteStyle`/`forceQuotes`/`noRefs`/`schema`); the rest are
 *     accepted-and-ignored (see the matrix).
 *   - Custom-tag definitions (`defineScalarTag`/`defineSequenceTag`/
 *     `defineMappingTag`, `Schema.withTags`) are still cheap stubs — our parser
 *     is hardwired to YAML 1.2 core (see ./index.ts) and cannot register a
 *     user-defined tag. The `*_SCHEMA` constants and the `schema` option are NOT
 *     stubs, however: they carry a core-vs-rich flag that the shim reads to
 *     toggle whether `!!binary`/`!!set`/`!!omap`/`!!pairs` resolve (rich) or are
 *     rejected as unknown tags (core) — see note [2] above.
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
import type { ParseOptions, StringifyOptions } from "./index.ts";

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

/**
 * Mirrors js-yaml v5's `Schema` shape (composition via `.withTags(...)`), plus
 * one field the shim actually reads: {@link richTags}. Tag composition itself
 * is still a no-op — our parser is hardwired to YAML 1.2 core — but the
 * core-vs-rich distinction between the exported schema constants IS honoured
 * (see the option matrix above): it toggles whether `!!binary`/`!!set`/… resolve
 * or are rejected as unknown tags.
 */
export class Schema {
  /** Whether this schema resolves the rich `!!binary`/`!!set`/`!!omap`/`!!pairs` tags. `true` only for {@link YAML11_SCHEMA}; user-built schemas default to `false` (core typing). */
  richTags = false;

  constructor(_tags?: readonly TagDefinition[]) {}

  withTags(..._tags: unknown[]): Schema {
    return this;
  }
}

function makeSchema(richTags: boolean): Schema {
  const s = new Schema();
  s.richTags = richTags;
  return s;
}

/** Only `!!str`/`!!seq`/`!!map` are recognised — same practical effect here as {@link CORE_SCHEMA}: the rich tags (`!!binary`/`!!set`/…) are rejected as unknown. */
export const FAILSAFE_SCHEMA: Schema = makeSchema(false);
/** JSON schema (no YAML-only tags). Like {@link CORE_SCHEMA} for our purposes: the rich `!!binary`/`!!set`/… tags are rejected. */
export const JSON_SCHEMA: Schema = makeSchema(false);
/** YAML 1.2 core schema — the strict mode. `!!binary`/`!!set`/`!!omap`/`!!pairs` are rejected as unknown tags (matching real js-yaml v5's default `load`). */
export const CORE_SCHEMA: Schema = makeSchema(false);
/** The rich bundle: `!!binary` → `Uint8Array`, `!!set` → `Set`, `!!omap` → insertion-ordered `Map`, `!!pairs` → array of one-key objects. This is lightning-yaml's own `parse()` behaviour, exposed under js-yaml v5's name for it. (It does NOT enable YAML-1.1 scalar typing — `yes`/`no`/`on`/`off` and sexagesimals stay plain strings; we are 1.2-only.) */
export const YAML11_SCHEMA: Schema = makeSchema(true);

// ---------------------------------------------------------------------------
// Options — the honoured knobs (LoadOptions: filename, schema, maxAliases,
// maxDepth · DumpOptions: indent, quoteStyle, forceQuotes, noRefs, schema) are
// wired through to ./index.ts; the rest are accepted-and-ignored so option bags
// still type-check. See the option matrix at the top of this file for the
// per-field status (and ❌ for the maxTotalMergeKeys non-goal).
//
// v5 REWRITE: these mirror v5's real `LoadOptions`/`DumpOptions` shapes, not
// v4's. v5 dropped `onWarning`/`listener` (load) and `styles`/`replacer`/
// `noCompatMode`/`condenseFlow`/`quotingType`/`noArrayIndent` (dump) outright;
// `noArrayIndent` became `seqNoIndent` and `quotingType: "'" | '"'` became
// `quoteStyle: "single" | "double"`.
// ---------------------------------------------------------------------------

export interface LoadOptions {
  /** Source path attached to a thrown {@link YAMLException}'s `mark.name`. Honoured. */
  filename?: string;
  /** {@link CORE_SCHEMA}/{@link JSON_SCHEMA}/{@link FAILSAFE_SCHEMA} (reject rich tags) vs. {@link YAML11_SCHEMA} (resolve them). Honoured; default is rich. */
  schema?: Schema;
  /** Duplicate-key policy. Ignored — we are always last-wins (`json: true`); see note [1] above. */
  json?: boolean;
  /** Cap on collection nesting depth. Honoured. */
  maxDepth?: number;
  /** ❌ Permanent non-goal: `<<` merge keys are a YAML-1.1 construct this library does not implement, so there is nothing to cap. Accepted (type-checks) but has no effect and never will. */
  maxTotalMergeKeys?: number;
  /** Cap on how many aliases may resolve before a `YAMLException` (billion-laughs guard). Honoured. */
  maxAliases?: number;
}

export interface DumpOptions {
  /** Block indent width per level (default 2; values < 1 fall back to 2). Honoured. */
  indent?: number;
  seqNoIndent?: boolean;
  seqInlineFirst?: boolean;
  skipInvalid?: boolean;
  flowLevel?: number;
  /** {@link YAML11_SCHEMA}/default emit `!!binary` for a `Uint8Array`; {@link CORE_SCHEMA}/{@link JSON_SCHEMA}/{@link FAILSAFE_SCHEMA} reject one. Honoured. */
  schema?: Schema;
  sortKeys?: boolean | ((a: unknown, b: unknown) => number);
  lineWidth?: number;
  /** Duplicate shared references instead of `&`/`*` anchoring; a genuine cycle throws. Honoured. */
  noRefs?: boolean;
  /** Preferred quote character when a scalar must be quoted. Honoured. */
  quoteStyle?: "single" | "double";
  /** Quote every string value even when it is bare-safe (keys/non-strings unaffected). Honoured. */
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
/**
 * Translate a {@link LoadOptions} bag into our core {@link ParseOptions}. Only
 * the honoured knobs cross over: `schema` (core vs. rich typing), `maxAliases`,
 * `maxDepth`. `filename` is handled separately (error marks), and `json` /
 * `maxTotalMergeKeys` are intentionally ignored (see the option matrix above).
 */
function toParseOptions(opts: LoadOptions | undefined): ParseOptions | undefined {
  if (opts === undefined) return undefined;
  return {
    // js-yaml counts the document root as depth 1 and throws when depth REACHES
    // maxDepth; our core throws when it EXCEEDS the cap. Shift by 1 here so the
    // compat boundary matches js-yaml for every nesting case, leaving the core's
    // own `parse(text, { maxDepth })` semantics untouched. (A bare top-level
    // scalar at maxDepth:1 — which js-yaml rejects — is the one residual gap: our
    // core never counts a non-collection root, so it parses; negligible in practice.)
    maxDepth: opts.maxDepth === undefined ? undefined : opts.maxDepth - 1,
    maxAliases: opts.maxAliases,
    // No schema ⇒ rich (lightning-yaml's own parse() default). CORE/JSON/
    // FAILSAFE_SCHEMA opt into strict typing; YAML11_SCHEMA is explicit rich.
    richTags: opts.schema === undefined ? true : opts.schema.richTags,
  };
}

export function load(input: string, opts?: LoadOptions): unknown {
  try {
    return ourParse(input, toParseOptions(opts));
  } catch (err) {
    if (err instanceof NotImplementedError) throw err;
    throw toYAMLException(err, opts?.filename);
  }
}

export function loadAll(input: string, iterator?: ((doc: unknown) => void) | null, opts?: LoadOptions): unknown[] | undefined {
  let docs: unknown[];
  try {
    docs = ourParseAll(input, toParseOptions(opts));
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

/**
 * Delegates to our `stringify`, threading the honoured dump knobs — `indent`,
 * `quoteStyle`, `forceQuotes`, `noRefs`, and `schema` (rich `!!binary` output
 * vs. core-schema rejection). The remaining DumpOptions (sortKeys, lineWidth,
 * flow-style knobs, transform, …) are still ignored — see the option matrix.
 */
export function dump(obj: unknown, opts?: DumpOptions): string {
  if (opts === undefined) return ourStringify(obj);
  const stringifyOpts: StringifyOptions = {
    indent: opts.indent,
    quoteStyle: opts.quoteStyle,
    forceQuotes: opts.forceQuotes,
    noRefs: opts.noRefs,
    // dump defaults to rich output (js-yaml's dump emits !!binary by default,
    // even though its load default does not); CORE/JSON/FAILSAFE_SCHEMA reject it.
    richTags: opts.schema === undefined ? true : opts.schema.richTags,
  };
  return ourStringify(obj, stringifyOpts);
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
