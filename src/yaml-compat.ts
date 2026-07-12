/**
 * yaml-compat.ts — a drop-in-ish replacement for the `yaml` v2 public API
 * (github.com/eemeli/yaml — also this repo's own correctness oracle, see
 * bench/oracle.ts), backed by lightning-yaml's own parser (./index.ts).
 *
 * Goal: a codebase doing `import { parse } from "yaml"` (or
 * `import YAML from "yaml"`) can swap the import for this module and keep
 * working, as far as lightning-yaml's current milestone allows. Full fidelity
 * is NOT the goal — see bench/conformance/compat.ts for a differential report
 * quantifying the gap, grouped by construct. Known simplifications, called
 * out where they matter below:
 *
 *   - Document wrappers (`parseDocument`/`parseAllDocuments`) return a MINIMAL
 *     stand-in: `{ toJS(), toJSON(), contents, errors, warnings }` where
 *     `contents` is already the plain JS value (real `yaml` gives you an AST
 *     `Node` there — Map/Seq/Scalar — and only `.toJS()` converts it). That's
 *     a deliberate, documented simplification (per the task brief) — fine for
 *     the overwhelmingly common `doc.toJS()` / `doc.toJSON()` call pattern,
 *     not fine for code that walks `.contents` as a CST/AST.
 *   - `stringify` delegates to our `stringify`, which is a later milestone
 *     and currently always throws `NotImplementedError`.
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
// stringify — delegates to our `stringify` (a later milestone; currently
// always throws `NotImplementedError`, per the task brief).
// ---------------------------------------------------------------------------

export function stringify(value: unknown, _replacerOrOptions?: unknown, _options?: unknown): string {
  return ourStringify(value);
}

const yamlCompat = { parse, parseAllDocuments, parseDocument, stringify };

export default yamlCompat;
