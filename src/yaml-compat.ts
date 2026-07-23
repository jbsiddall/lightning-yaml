/**
 * @packageDocumentation
 *
 * yaml-compat.ts — a drop-in-ish replacement for the `yaml` v2 public API
 * (github.com/eemeli/yaml — also this repo's own correctness reference /
 * oracle, see bench/oracle.ts), backed by lightning-yaml's own parser
 * (./core.ts).
 *
 * This module doc block is the MASTER SOURCE for `yaml` compatibility: it is
 * published verbatim to the website's API reference (site/astro.config.mjs
 * wires this file through starlight-typedoc), so keep it accurate and up to date.
 *
 * ## Compatibility level TODAY
 *
 * **API-level, not behaviour-complete.** The exports and call signatures match
 * the real `yaml` library, so `import { parse } from "yaml"` (or the default
 * import) can swap to this module and keep running. Options are honoured on a
 * growing allowlist, and anything not yet honoured **throws** rather than
 * silently diverging. Today only the `parse` reviver runs, plus `schema` /
 * `version` accepted *as the 1.2-core defaults* (`"core"` / `"1.2"`) — e.g.
 * `parse(text, { mapAsMap: true })` or `stringify(value, { indent: 4 })` throws
 * until that option's sub-task lands. A relied-upon option fails loud instead
 * of producing silently-wrong output (walking `.contents` as an AST — see the
 * Document note below — remains a documented gap).
 *
 * ## Goal
 *
 * Maximise drop-in compatibility **without ever compromising the two things
 * that outrank it: YAML-1.2-spec correctness and core (./core.ts) speed.**
 * Per-option cost is paid either in this shim (pre-/post-processing the
 * plain-JS value, as the reviver already does — proof a hook here costs the
 * core nothing) or behind a gated core seam that leaves the options-free fast
 * path byte-identical. An option we can't yet honour **fails loud** (throws)
 * rather than being silently ignored; each option sub-task moves its key onto
 * the honoured allowlist.
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
 *     (./core.ts) is ALSO named `YAMLParseError`, purely by coincidence — a
 *     different class with a different prototype chain, so
 *     `e instanceof (real yaml's) YAMLParseError` will not match ours. Not
 *     chased further for this milestone.
 */

import { parse as ourParse, parseAll as ourParseAll, stringify as ourStringify } from "./core.ts";
import { validateOptions, notYetSupported, activatesFeature, type OptionRule } from "./compat-options.ts";

// ---------------------------------------------------------------------------
// Options-dispatch rules. Unsupported options throw a `YAMLCompatError` rather
// than being silently ignored; each option sub-task flips a key's rule from
// throwing to honoured. (The `yaml` library takes STRING `schema`/`version`
// values, unlike js-yaml's Schema objects.)
// ---------------------------------------------------------------------------

/** Thrown when a `./yaml` compat option isn't honoured yet. */
class YAMLCompatError extends Error {
  override name = "YAMLCompatError";
}

const failOption = (message: string): never => {
  throw new YAMLCompatError(`lightning-yaml yaml compat: ${message}`);
};

/** Only the default `core` schema is a no-op; others change scalar typing. */
const schemaCoreOnly: OptionRule = (v) =>
  v === "core"
    ? null
    : `"${String(v)}" changes scalar typing — only the default "core" schema is supported`;

/** We target YAML 1.2 core; `1.1` (and other versions) change scalar typing. */
const version12Only: OptionRule = (v) =>
  v === "1.2"
    ? null
    : `"${String(v)}" is not supported — lightning-yaml targets YAML 1.2 core only`;

const PARSE_OPTION_RULES: Record<string, OptionRule> = {
  schema: schemaCoreOnly,
  version: version12Only,
  prettyErrors: () => null, // no-op: our thrown errors already carry line/column
  mapAsMap: activatesFeature("would return mappings as `Map` rather than plain objects — not supported yet"),
  intAsBigInt: activatesFeature("would return large integers as exact `BigInt` — not supported yet"),
  uniqueKeys: activatesFeature("would throw on duplicate keys — not supported yet (lightning-yaml keeps last-wins)"),
  stringKeys: activatesFeature("would require scalar string keys — not supported yet"),
  merge: activatesFeature("would enable `<<` merge keys, which are outside YAML 1.2 core"),
  maxAliasCount: notYetSupported,
  customTags: notYetSupported,
  resolveKnownTags: notYetSupported,
  keepSourceTokens: notYetSupported,
  lineCounter: notYetSupported,
  onAnchor: notYetSupported,
};

const STRINGIFY_OPTION_RULES: Record<string, OptionRule> = {
  schema: schemaCoreOnly,
  version: version12Only,
  singleQuote: activatesFeature("would prefer single quotes — not supported yet"),
  sortMapEntries: activatesFeature("would sort map entries on output — not supported yet"),
  indent: notYetSupported,
  nullStr: notYetSupported,
  trueStr: notYetSupported,
  falseStr: notYetSupported,
  indentSeq: notYetSupported,
  directives: notYetSupported,
  lineWidth: notYetSupported,
  minContentWidth: notYetSupported,
  blockQuote: notYetSupported,
  collectionStyle: notYetSupported,
  flowCollectionPadding: notYetSupported,
  aliasDuplicateObjects: notYetSupported,
  anchorPrefix: notYetSupported,
  customTags: notYetSupported,
};

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
 * ./core.ts) also throws on a second document, so this divergence-prone case
 * is naturally aligned with no special-casing needed here.
 */
export function parse(src: string, reviverOrOpts?: Reviver | Record<string, unknown> | null, opts?: Record<string, unknown>): unknown {
  const reviver = typeof reviverOrOpts === "function" ? (reviverOrOpts as Reviver) : undefined;
  // Disambiguate `yaml`'s overloads: a non-null, non-function 2nd arg IS the
  // options bag; otherwise (a reviver, or omitted) the options are the 3rd arg —
  // so the bag is validated whichever legal call shape the caller used.
  const optionBag = reviverOrOpts != null && typeof reviverOrOpts !== "function" ? reviverOrOpts : opts;
  validateOptions(optionBag, PARSE_OPTION_RULES, failOption);
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
 * it still parse independently. Our `parseAll` (./core.ts) is single-shot
 * and throws on the FIRST error anywhere in the stream, so on failure we
 * can't recover whichever documents parsed fine before it. Best-effort
 * approximation: report ONE Document carrying the error. Partial fidelity —
 * documented gap, not chased further this milestone. (An unsupported option,
 * unlike a parse error, throws up front — see the option rules above.)
 */
export function parseAllDocuments(src: string, opts?: Record<string, unknown>): CompatDocument[] {
  validateOptions(opts, PARSE_OPTION_RULES, failOption);
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
 * way `parseDocument` never throws on a *parse* error, matching the real
 * contract. (Like every entry point it still throws up front on an unsupported
 * option — see the option rules above.)
 */
export function parseDocument(src: string, opts?: Record<string, unknown>): CompatDocument {
  validateOptions(opts, PARSE_OPTION_RULES, failOption);
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

export function stringify(value: unknown, replacerOrOptions?: unknown, options?: unknown): string {
  const hasReplacer = typeof replacerOrOptions === "function" || Array.isArray(replacerOrOptions);
  // A non-null, non-replacer 2nd arg IS the options bag; otherwise (a replacer,
  // or omitted) the options are the 3rd arg — so options are validated under
  // every legal call shape, including `stringify(value, null, options)`.
  const optionBag = (!hasReplacer && replacerOrOptions != null && typeof replacerOrOptions === "object"
    ? replacerOrOptions
    : options) as Record<string, unknown> | undefined;
  validateOptions(optionBag, STRINGIFY_OPTION_RULES, failOption);
  if (hasReplacer) failOption("a replacer is not supported yet — the ./yaml stringify replacer is tracked separately");
  return ourStringify(value);
}

const yamlCompat = { parse, parseAllDocuments, parseDocument, stringify };

export default yamlCompat;
