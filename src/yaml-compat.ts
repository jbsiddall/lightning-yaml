/**
 * @packageDocumentation
 *
 * yaml-compat.ts — a drop-in-ish replacement for the `yaml` v2 public API
 * (github.com/eemeli/yaml — also this repo's own correctness reference /
 * oracle, see bench/oracle.ts), backed by lightning-yaml's own parser
 * (./index.ts).
 *
 * This module doc block is the MASTER SOURCE for `yaml` compatibility: it is
 * published verbatim to the website's API reference (site/astro.config.mjs
 * wires this file through starlight-typedoc), so keep it accurate and up to date.
 *
 * ## Compatibility level TODAY
 *
 * **API-level, not behaviour-complete.** The exports and call signatures match
 * the real `yaml` library, so `import { parse } from "yaml"` (or the default
 * import) can swap to this module and keep running. What is NOT yet honoured is
 * almost every **option argument**: `parse(text, { version, schema, mapAsMap,
 * intAsBigInt })` and `stringify(value, { sortMapEntries, indent, ... })` are
 * accepted so call sites type-check, but are currently **ignored** — only the
 * `parse` reviver function actually runs. The shim is genuinely useful for
 * migrating today, but a call that relies on an option (or walks `.contents`
 * as an AST — see the Document note below) will diverge from real `yaml`.
 *
 * ## Goal
 *
 * Maximise drop-in compatibility **without ever compromising the two things
 * that outrank it: YAML-1.2-spec correctness and core (./index.ts) speed.**
 * Per-option cost is paid either in this shim (pre-/post-processing the
 * plain-JS value, as the reviver already does — proof a hook here costs the
 * core nothing) or behind a gated core seam that leaves the options-free fast
 * path byte-identical. An option we can't yet honour should eventually FAIL
 * LOUD, not be silently ignored. We are not there yet — this file tracks it.
 *
 * ## Option support matrix
 *
 * `path` — `done`: already honoured · `compat`: addable in THIS shim, no core
 * change and no core perf cost · `core`: gated core change, options-free fast
 * path stays byte-identical · `feature`: needs a parser/dumper capability that
 * does not exist yet.
 *
 * ```text
 * parse / parseDocument / parseAllDocuments (ParseOptions·DocumentOptions·SchemaOptions·ToJSOptions)
 *   reviver           JSON.parse-style revive walk               done
 *   prettyErrors      line/col in errors                         done         (our errors carry them)
 *   mapAsMap          mappings as Map, not Object                compat       [1] (deep Object->Map post-parse)
 *   intAsBigInt       big ints as exact BigInt                   core         (cold >15-digit fallback fork)
 *   uniqueKeys        dup-key throw/comparator vs keep           core         [2]
 *   stringKeys        require scalar string keys                 core
 *   maxAliasCount     cap alias expansions                       compat/core
 *   version           1.1 | 1.2 | next scalar typing             core         [3]
 *   schema            failsafe / core / json / yaml-1.1          core         [3]
 *   customTags        plug in custom tag resolvers               core         (needs a tag registry)
 *   resolveKnownTags  !!omap/!!set/!!timestamp under core        core         (we resolve !!binary only)
 *   merge             enable `<<` merge keys                     feature      (merge keys unimplemented)
 *   keepSourceTokens · lineCounter · onAnchor                    feature      (need CST / retained metadata)
 *
 * stringify (ToStringOptions·CreateNodeOptions·SchemaOptions)
 *   replacer          JSON.stringify-style replacer              compat       (pre-process the value)
 *   sortMapEntries    sort map keys on output                    compat       <- easy win (pre-sort the graph)
 *   indent            block indent width (we hardcode 2)         core
 *   nullStr/trueStr/falseStr  spelling of null/true/false        core
 *   singleQuote       prefer single quotes                       core
 *   indentSeq         indent block sequences                     core
 *   directives        emit `---` / %YAML markers                 core
 *   lineWidth · minContentWidth · blockQuote (folding)           feature      (no line folding exists)
 *   collectionStyle:flow · flowCollectionPadding · trailingComma feature      (no flow-collection writer)
 *   aliasDuplicateObjects / noRefs · anchorPrefix                core/feature (see js-yaml-compat noRefs note)
 * ```
 *
 * [1] Our core already coerces non-scalar keys to strings, so `mapAsMap` keys
 *     come back as strings — partial fidelity vs real `yaml`.
 * [2] Our core is last-wins by default (= `uniqueKeys: false`). Throw-on-dup is
 *     a `yaml`-parity knob, NOT a spec/suite win — the yaml-test-suite treats
 *     duplicate keys as VALID (see js-yaml-compat.ts note [1]).
 * [3] Default 1.2-core already matches `yaml`'s own default; only `version: 1.1`
 *     / a non-core schema changes typing (yes->true, sexagesimal, legacy octal).
 *
 * The remaining known simplifications, called out where they matter below:
 *
 *   - Document wrappers (`parseDocument`/`parseAllDocuments`) return a MINIMAL
 *     stand-in: `{ toJS(), toJSON(), contents, errors, warnings }` where
 *     `contents` is already the plain JS value (real `yaml` gives you an AST
 *     `Node` there — Map/Seq/Scalar — and only `.toJS()` converts it). That's
 *     a deliberate, documented simplification (per the task brief) — fine for
 *     the overwhelmingly common `doc.toJS()` / `doc.toJSON()` call pattern,
 *     not fine for code that walks `.contents` as a CST/AST.
 *   - `stringify` delegates to our `stringify` (implemented: block-style
 *     output with 1.2-core-safe quoting).
 *   - We don't wrap thrown errors in `yaml`'s own `YAMLParseError`/`YAMLWarning`
 *     classes (unlike js-yaml-compat.ts, which IS required to rethrow as its
 *     own `YAMLException` — see that file). Confusingly, our own error class
 *     (./index.ts) is ALSO named `YAMLParseError`, purely by coincidence — a
 *     different class with a different prototype chain, so
 *     `e instanceof (real yaml's) YAMLParseError` will not match ours. Not
 *     chased further for this milestone.
 */

import { parse as ourParse, parseAll as ourParseAll, stringify as ourStringify } from "./index.ts";

// ---------------------------------------------------------------------------
// parse — calibrated against the REAL `yaml` v2 library, not assumed.
// ---------------------------------------------------------------------------

/** A `JSON.parse`-style reviver: `function (this, key, value) { ... return value }`. */
export type Reviver = (this: unknown, key: string, value: unknown) => unknown;

/**
 * Bottom-up walk matching `JSON.parse`'s own reviver algorithm (ECMA-262
 * `InternalizeJSONProperty`) — verified empirically that the real `yaml`
 * library's reviver support behaves the same way (called once per array
 * element / object property, deepest first, with string keys for array
 * indices, then once more for the synthetic root holder).
 */
function applyReviver(holder: Record<string, unknown>, key: string, reviver: Reviver): unknown {
  const value = holder[key];
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const revived = applyReviver(value as unknown as Record<string, unknown>, String(i), reviver);
        if (revived === undefined) delete value[i];
        else value[i] = revived;
      }
    } else {
      const obj = value as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        const revived = applyReviver(obj, k, reviver);
        if (revived === undefined) delete obj[k];
        else obj[k] = revived;
      }
    }
  }
  return reviver.call(holder, key, value);
}

/**
 * Multi-document calibration (checked against real `yaml@2.9`, not assumed):
 * `YAML.parse()` on a source with more than one document THROWS —
 * `"Source contains multiple documents; please use YAML.parseAllDocuments()"`
 * — it does not silently return the first document. Our own `parse()` (see
 * ./index.ts) also throws on a second document, so this divergence-prone case
 * is naturally aligned with no special-casing needed here.
 */
export function parse(src: string, reviverOrOpts?: Reviver | Record<string, unknown>, _opts?: Record<string, unknown>): unknown {
  const reviver = typeof reviverOrOpts === "function" ? (reviverOrOpts as Reviver) : undefined;
  const value = ourParse(src);
  if (!reviver) return value;
  const holder: Record<string, unknown> = { "": value };
  return applyReviver(holder, "", reviver);
}

// ---------------------------------------------------------------------------
// Document wrappers — minimal, per the task brief (see module doc comment).
// ---------------------------------------------------------------------------

export interface CompatDocument {
  contents: unknown;
  errors: Error[];
  warnings: Error[];
  toJS(): unknown;
  toJSON(): unknown;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function makeDocument(contents: unknown, errors: Error[] = []): CompatDocument {
  return {
    contents,
    errors,
    warnings: [],
    toJS: () => contents,
    toJSON: () => contents,
  };
}

/**
 * Real `yaml`'s `parseAllDocuments` never throws — a malformed document's
 * error is captured in THAT document's `.errors`, and documents before/after
 * it still parse independently. Our `parseAll` (./index.ts) is single-shot
 * and throws on the FIRST error anywhere in the stream, so on failure we
 * can't recover whichever documents parsed fine before it. Best-effort
 * approximation: report ONE Document carrying the error. Partial fidelity —
 * documented gap, not chased further this milestone.
 */
export function parseAllDocuments(src: string, _opts?: Record<string, unknown>): CompatDocument[] {
  try {
    return ourParseAll(src).map((v) => makeDocument(v));
  } catch (err) {
    return [makeDocument(undefined, [toError(err)])];
  }
}

/**
 * Real `yaml.parseDocument` on multi-document input specifically: it returns
 * the FIRST document's contents with a "multiple documents" error captured in
 * `.errors` (non-throwing), rather than rejecting outright. We approximate
 * that one case by falling back to `parseAll(src)[0]`; any other parse
 * failure yields an empty-contents Document with the error captured — either
 * way `parseDocument` itself never throws, matching the real contract.
 */
export function parseDocument(src: string, _opts?: Record<string, unknown>): CompatDocument {
  try {
    return makeDocument(ourParse(src));
  } catch (err) {
    let contents: unknown;
    try {
      contents = ourParseAll(src)[0];
    } catch {
      contents = undefined;
    }
    return makeDocument(contents, [toError(err)]);
  }
}

// ---------------------------------------------------------------------------
// stringify — delegates to our `stringify`.
// ---------------------------------------------------------------------------

export function stringify(value: unknown, _replacerOrOptions?: unknown, _options?: unknown): string {
  return ourStringify(value);
}

const yamlCompat = { parse, parseAllDocuments, parseDocument, stringify };

export default yamlCompat;
