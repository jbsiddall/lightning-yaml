/**
 * @packageDocumentation
 *
 * The fast value parse and stringify functions keep their existing core
 * implementation. Source parsing returns editable native documents and nodes
 * through parseDocument and parseAllDocuments, with CST tokens available from
 * Parser and CST for source-aware tools.
 *
 * Source documents support YAML 1.2 core plus explicitly registered application
 * tags. The default known explicit tag is !!binary; YAML 1.1, merge keys, and
 * non-core schemas are rejected. Parsing and conversion options are separate:
 * pass source options to a document parser, and pass alias/map/reviver options to
 * doc.toJS(). Unsupported option keys or values throw.
 *
 * This is a selected compatibility surface, not a complete yaml replacement or
 * an end-to-end yaml-language-server acceptance claim. Source diagnostic classes
 * describe Composer/Document diagnostics; the fast value parser has its own
 * error class.
 *
 * ## Option support matrix
 *
 * | Option family | Fast `parse` / `stringify` | Source parse | Native `Document` |
 * | --- | --- | --- | --- |
 * | Core schema and version 1.2 | Accepted | Accepted | Accepted |
 * | YAML 1.1, other schemas, merge keys | Throws | Throws | Throws |
 * | `customTags` | Throws | Explicit scalar/collection tags and callbacks | Explicit scalar/collection tags |
 * | `keepSourceTokens`, `lineCounter`, `prettyErrors`, `strict`, `intAsBigInt` | Throws where unsupported by the fast value path | Applied by Parser/Composer | Applied by Document/Schema where relevant |
 * | Value conversion (`mapAsMap`, `maxAliasCount`, `onAnchor`, `reviver`) | `reviver` is supported; other active options throw | Conversion options throw here | Pass supported conversion options to `doc.toJS()` |
 * | Creation and writer options (`toStringDefaults`, `sortMapEntries`, `flow`, `tag`) | Active top-level options throw | Schema writer options are passed through | Applied by `Document` and its writer |
 *
 * Example editing a parsed source document:
 *
 * ```ts
 * const doc = parseDocument('name: example\nitems: [one, two]\n')
 * doc.setIn(['items', 1], 'three')
 * const yaml = doc.toString()
 * const value = doc.toJS()
 * ```
 *
 * Unsupported keys, schema values and option placements throw instead of
 * being silently ignored. The `parse`/`stringify` value path remains separate
 * from native source documents.
 */

import { parse as ourParse, stringify as ourStringify, yamlDocumentOptions } from "./core.ts";
import { validateOptions, notYetSupported, activatesFeature, type OptionRule } from "./compat-options.ts";
import { LineCounter } from "./line-counter.ts";
import { Composer } from "./source/compose/composer.ts";
import { Document } from "./source/doc/Document.ts";
import { Alias } from "./source/nodes/Alias.ts";
import { Pair } from "./source/nodes/Pair.ts";
import { Scalar } from "./source/nodes/Scalar.ts";
import { YAMLMap } from "./source/nodes/YAMLMap.ts";
import { YAMLSeq } from "./source/nodes/YAMLSeq.ts";
import { isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar, isSeq } from "./source/nodes/identity.ts";
import { Schema } from "./source/schema/Schema.ts";
import { YAMLParseError, YAMLWarning, YAMLError, prettifyError } from "./source/errors.ts";
import { visit } from "./source/visit.ts";
import { Lexer } from "./source/lexer.ts";
import { Parser } from "./source/parser.ts";
import * as CST from "./source/cst.ts";
import type { Token as CSTToken, SourceToken as CSTSourceToken } from "./source/cst.ts";
import type { Node, NodeType, ParsedNode, Range } from "./source/nodes/Node.ts";
import type { ParseOptions, DocumentOptions, SchemaOptions, CreateNodeOptions, ToJSOptions, ToStringOptions } from "./source/options.ts";
import type { CollectionTag, ScalarTag } from "./source/schema/types.ts";
import type { TagId, Tags } from "./source/schema/tags.ts";
import type { visitor, visitorFn, asyncVisitor, asyncVisitorFn } from "./source/visit.ts";
import type { ErrorCode, LinePos } from "./source/errors.ts";
import type { ComposeErrorHandler } from "./source/compose/composer.ts";

export { LineCounter, Composer, Document, Alias, Pair, Scalar, YAMLMap, YAMLSeq, Schema, isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar, isSeq, visit, YAMLParseError, YAMLWarning, YAMLError, Lexer, Parser, CST };
export type { CSTToken, CSTSourceToken, Node, NodeType, ParsedNode, Range, ParseOptions, DocumentOptions, SchemaOptions, CreateNodeOptions, ToJSOptions, ToStringOptions, CollectionTag, ScalarTag, Tags, TagId, visitor, visitorFn, asyncVisitor, asyncVisitorFn, ErrorCode, LinePos, ComposeErrorHandler };

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

const booleanOption: OptionRule = value =>
  typeof value === "boolean" ? null : "must be a boolean";

const SOURCE_DOCUMENT_OPTION_RULES: Record<string, OptionRule> = {
  schema: schemaCoreOnly,
  version: version12Only,
  intAsBigInt: booleanOption,
  keepSourceTokens: booleanOption,
  prettyErrors: booleanOption,
  strict: booleanOption,
  stringKeys: booleanOption,
  uniqueKeys: value =>
    typeof value === "boolean" || typeof value === "function"
      ? null
      : "must be a boolean or comparison function",
  lineCounter: value =>
    value instanceof LineCounter ? null : "must be a LineCounter instance",
  logLevel: value =>
    value === "silent" || value === "error" || value === "warn" || value === "debug"
      ? null
      : "must be one of silent, error, warn, or debug",
  customTags: value =>
    value === null || Array.isArray(value) || typeof value === "function"
      ? null
      : "must be a tag array or tag-list callback",
  resolveKnownTags: value =>
    value === true ? null : "only the supported core tags can be resolved",
  merge: notYetSupported,
  compat: notYetSupported,
  sortMapEntries: value =>
    typeof value === "boolean" || typeof value === "function"
      ? null
      : "must be a boolean or comparison function",
  toStringDefaults: value =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? null
      : "must be an object",
};

const STRINGIFY_OPTION_RULES: Record<string, OptionRule> = {
  schema: schemaCoreOnly,
  version: version12Only,
  // NOT activatesFeature: our stringify already prefers single quotes (like yaml's singleQuote:true),
  // so even `false` isn't a no-op — every explicit value must fail loud.
  singleQuote: notYetSupported,
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
 * Multi-document behavior is checked against `yaml@2.9`: these entrypoints
 * preserve its suffix-as-empty-document counting through an internal parser
 * option. Native parsing and the js-yaml shim keep core stream semantics.
 */
export function parse(src: string, reviverOrOpts?: Reviver | Record<string, unknown> | null, opts?: Record<string, unknown>): unknown {
  const reviver = typeof reviverOrOpts === "function" ? (reviverOrOpts as Reviver) : undefined;
  // Disambiguate `yaml`'s overloads exactly as real `yaml` does (dist/public-api.js): the 2nd arg is the
  // options bag ONLY in the 2-arg form (no 3rd arg, `opts === undefined`) AND only when truthy — a falsy
  // 2nd arg means "no options", like omitted; a present 3rd arg wins, so a well-formed options object
  // there is never silently dropped. (Truthy-gating is behaviour-neutral for parse — validateOptions
  // tolerates a scalar bag either way — but it mirrors real yaml and applies the same truthy-gate rule
  // as stringify below.)
  const optionBag = opts === undefined && typeof reviverOrOpts !== "function" && reviverOrOpts ? reviverOrOpts : opts;
  validateOptions(optionBag, PARSE_OPTION_RULES, failOption);
  const value = ourParse(src, yamlDocumentOptions);
  if (!reviver) return value;
  const holder: Record<string, unknown> = { "": value };
  return applyReviver(holder, "", reviver);
}

// ---------------------------------------------------------------------------
// Source documents use the native Composer graph; value parse remains separate.
// ---------------------------------------------------------------------------

export type CompatDocument = Document.Parsed;

export interface EmptyStream
  extends Array<CompatDocument>, ReturnType<Composer["streamInfo"]> {
  empty: true;
}

type SourceParseOptions = ParseOptions & DocumentOptions & SchemaOptions;

function sourceParseState(source: string, options: SourceParseOptions) {
  validateOptions(options, SOURCE_DOCUMENT_OPTION_RULES, failOption);
  const prettyErrors = options.prettyErrors !== false;
  const lineCounter = options.lineCounter ?? (prettyErrors ? new LineCounter() : null);
  const parser = new Parser(lineCounter?.addNewLine);
  const composer = new Composer(options);
  const tokens = parser.parse(source);
  return { composer, tokens, lineCounter, prettyErrors };
}

function formatDocumentDiagnostics(
  source: string,
  docs: Iterable<CompatDocument>,
  lineCounter: LineCounter | null,
  prettyErrors: boolean
) {
  if (!prettyErrors || !lineCounter) return;
  for (const doc of docs) {
    doc.errors.forEach(prettifyError(source, lineCounter));
    doc.warnings.forEach(prettifyError(source, lineCounter));
  }
}

export function parseAllDocuments(
  src: string,
  opts: SourceParseOptions = {}
): CompatDocument[] | EmptyStream {
  const { composer, tokens, lineCounter, prettyErrors } = sourceParseState(src, opts);
  const docs = [...composer.compose(tokens)];
  if (docs.length > 0) {
    formatDocumentDiagnostics(src, docs, lineCounter, prettyErrors);
    return docs;
  }
  const empty = Object.assign([], { empty: true }, composer.streamInfo()) as EmptyStream;
  formatDocumentDiagnostics(src, [empty as unknown as CompatDocument], lineCounter, prettyErrors);
  return empty;
}

export function parseDocument(
  src: string,
  opts: SourceParseOptions = {}
): CompatDocument {
  const { composer, tokens, lineCounter, prettyErrors } = sourceParseState(src, opts);
  let doc: CompatDocument | undefined;
  for (const next of composer.compose(tokens, true, src.length)) {
    if (!doc) doc = next;
    else if (doc.options.logLevel !== "silent") {
      doc.errors.push(new YAMLParseError(
        [next.range[0], next.range[1]],
        "MULTIPLE_DOCS",
        "Source contains multiple documents; please use YAML.parseAllDocuments()"
      ));
      break;
    }
  }
  if (!doc) throw new Error("Composer did not emit the forced source document");
  formatDocumentDiagnostics(src, [doc], lineCounter, prettyErrors);
  return doc;
}

// ---------------------------------------------------------------------------
// stringify — delegates to our `stringify`.
// ---------------------------------------------------------------------------

export function stringify(value: unknown, replacerOrOptions?: unknown, options?: unknown): string {
  const hasReplacer = typeof replacerOrOptions === "function" || Array.isArray(replacerOrOptions);
  // Real `yaml` promotes the 2nd arg to options only in the 2-arg form (no 3rd arg) AND only when it's
  // TRUTHY — a falsy 2nd arg (`false`/`0`/`""`, e.g. a conditional `cond && replacer`) means "no options",
  // like `null`/omitted. A present 3rd arg always wins. (Matches real yaml's `options === undefined && replacer`.)
  const optionsSlot = options === undefined && !hasReplacer && replacerOrOptions ? replacerOrOptions : options;
  // After the truthy gate above, a falsy 2nd arg already fell through as "no options", so a non-object
  // reaching here is a truthy 2nd-arg shorthand or a scalar handed straight to the 3rd-arg slot. A
  // number/string is `yaml.stringify`'s `JSON.stringify`-style indent shorthand (number = width, string
  // = its length — e.g. `stringify({a:{b:1}}, 4)` indents 4, not our hardcoded 2), which we can't honour;
  // any other primitive (boolean/symbol/bigint) real `yaml` itself throws on. An array falls through as a
  // no-op (it's `typeof "object"`). validateOptions TOLERATES a scalar (right for parse/load/dump, which
  // ignore it), so stringify — the one entry point where a scalar is meaningful — rejects it here.
  // Residual vs real `yaml`: it treats any truthy number/string here as an indent width and rounds/clamps
  // it (`Math.round(n) < 1` → its default, `> 8` → 8), so it always produces output; we can't honour a
  // custom indent, so we reject every such value (both the 2-arg `stringify(v, -3)` and 3-arg positions) —
  // a deliberate, fail-loud-safe superset of real yaml's clamp table, documented in README's "Decisions
  // and deviations" (the compat-options-throw bullet, which names this shorthand).
  if (optionsSlot != null && typeof optionsSlot !== "object") {
    failOption(
      typeof optionsSlot === "number" || typeof optionsSlot === "string"
        ? "the JSON.stringify-style indent shorthand (stringify(value, replacer, indent)) is not supported yet — custom indent width is unimplemented"
        : `stringify options must be an object; received a ${typeof optionsSlot}`,
    );
  }
  validateOptions(optionsSlot as Record<string, unknown> | undefined, STRINGIFY_OPTION_RULES, failOption);
  if (hasReplacer) failOption("a replacer is not supported yet — the ./yaml stringify replacer is tracked separately");
  return ourStringify(value);
}

const yamlCompat = {
  parse,
  parseAllDocuments,
  parseDocument,
  stringify,
  LineCounter,
  Composer,
  Document,
  Alias,
  Pair,
  Scalar,
  YAMLMap,
  YAMLSeq,
  Schema,
  isAlias,
  isCollection,
  isDocument,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  visit,
  YAMLParseError,
  YAMLWarning,
  YAMLError,
  Lexer,
  Parser,
  CST,
};

export default yamlCompat;
