/**
 * @packageDocumentation
 *
 * Selected `yaml` v2 entry points. The API remains partial; it is not a
 * drop-in replacement. `parse` and `stringify` continue to use the native
 * lightning-yaml value parser and writer. `parseDocument` and
 * `parseAllDocuments` use the source Lexer, Parser, Composer, and Document
 * node graph, so `.contents` is now a Scalar, YAMLMap, YAMLSeq, Alias, or null.
 * Convert it with `doc.toJS()` or `doc.toJSON()` when a plain value is needed.
 *
 * The source document path supports YAML 1.2 core, strict syntax checks,
 * source tokens, line counters, diagnostics, `uniqueKeys`, `stringKeys`, and
 * `intAsBigInt`. Conversion controls such as `mapAsMap` and `maxAliasCount`
 * belong on `doc.toJS()`. Unsupported options throw. Directives selecting a
 * different schema or version, custom tags, and merge-key expansion options
 * are rejected; a literal `<<` key is retained. Supported explicit known tags
 * such as `!!binary` remain available. Source
 * documents reject tab indentation by default, while the native value parser
 * keeps its separately documented leniency.
 *
 * `YAMLParseError` and `YAMLWarning` exported here are the source document
 * diagnostic classes. The native value parser continues to throw the distinct
 * error class from `core.ts`; the shared class name does not imply a common
 * prototype or `instanceof` relationship. `CSTToken` and `CSTSourceToken` are
 * structural types; no CST runtime namespace or mutation helpers are exported.
 */
import { parse as ourParse, stringify as ourStringify, yamlDocumentOptions } from "./core.ts";
import { validateOptions, notYetSupported, activatesFeature, type OptionRule } from "./compat-options.ts";
import { LineCounter } from "./line-counter.ts";
export { LineCounter } from "./line-counter.ts";
import { Lexer } from "./source/lexer.ts";
import { Parser } from "./source/parser.ts";
export { Lexer, Parser };
export type { Token as CSTToken, SourceToken as CSTSourceToken } from "./source/cst.ts";
import { Composer } from "./source/compose/composer.ts";
import { Document } from "./source/doc/Document.ts";
import { YAMLParseError, YAMLWarning, prettifyError } from "./source/errors.ts";
import { Alias } from "./source/nodes/Alias.ts";
import type { Node } from "./source/nodes/Node.ts";
import { Pair } from "./source/nodes/Pair.ts";
import { Scalar } from "./source/nodes/Scalar.ts";
import { YAMLMap } from "./source/nodes/YAMLMap.ts";
import { YAMLSeq } from "./source/nodes/YAMLSeq.ts";
import {
  isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar, isSeq,
} from "./source/nodes/identity.ts";
import type { ParsedNode, Range } from "./source/nodes/Node.ts";
export { Composer, Document, Alias, Pair, Scalar, YAMLMap, YAMLSeq, YAMLParseError, YAMLWarning };
export { isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar, isSeq };
export type { Node, ParsedNode, Range };
export type { NodeType } from "./source/nodes/Node.ts";
export type {
  CreateNodeOptions,
  DocumentOptions,
  ParseOptions,
  SchemaOptions,
  ToJSOptions,
  ToStringOptions,
} from "./source/options.ts";
export type { Replacer } from "./source/doc/Document.ts";

// Native value APIs and source-document APIs have separate option contracts.

/** Thrown when a `./yaml` compat option isn't honoured yet. */
class YAMLCompatError extends Error {
  override name = "YAMLCompatError";
}

const failOption = (message: string): never => {
  throw new YAMLCompatError(`lightning-yaml yaml compat: ${message}`);
};

/** Only the default `core` schema is supported by source documents. */
const schemaCoreOnly: OptionRule = (v) =>
  v === "core"
    ? null
    : `"${String(v)}" changes scalar typing — only the default "core" schema is supported`;

/** Source documents target YAML 1.2 core. */
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

const SOURCE_DOCUMENT_OPTION_RULES: Record<string, OptionRule> = {
  version: version12Only,
  schema: schemaCoreOnly,
  keepSourceTokens: () => null,
  lineCounter: () => null,
  prettyErrors: () => null,
  uniqueKeys: () => null,
  stringKeys: () => null,
  intAsBigInt: () => null,
  strict: () => null,
  logLevel: () => null,
  resolveKnownTags: (value) =>
    value === true ? null : "source documents always resolve the supported explicit core tags",
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
// Source-aware documents are composed from the public parser's token stream.
// ---------------------------------------------------------------------------

/** @deprecated Parsed documents now expose the full source-aware Document API. */
export type CompatDocument = Document.Parsed;

function composeSourceDocuments(src: string, options: Record<string, unknown> = {}, forceDoc = false): Document.Parsed[] {
  validateOptions(options, SOURCE_DOCUMENT_OPTION_RULES, failOption);
  const lineCounter = (options.lineCounter as LineCounter | undefined) ??
    ((options.prettyErrors ?? true) ? new LineCounter() : undefined);
  const parser = new Parser(lineCounter?.addNewLine);
  const composer = new Composer({ ...options, lineCounter, uniqueKeys: options.uniqueKeys ?? false } as never);
  const documents = [...composer.compose(parser.parse(src), forceDoc, src.length)];
  if (options.prettyErrors !== false && lineCounter) {
    for (const doc of documents) {
      for (const error of [...doc.errors, ...doc.warnings]) prettifyError(src, lineCounter)(error);
    }
  }
  return documents;
}

/** Parse every source document, retaining each document's diagnostics. */
export function parseAllDocuments(src: string, opts?: Record<string, unknown>): CompatDocument[] {
  return composeSourceDocuments(src, opts);
}

/** Return the first source document; record additional-document input as an error. */
export function parseDocument(src: string, opts?: Record<string, unknown>): CompatDocument {
  const docs = composeSourceDocuments(src, opts, true);
  const doc = docs[0]!;
  if (docs.length > 1) doc.errors.push(new YAMLParseError([docs[1]!.range?.[0] ?? src.length, docs[1]!.range?.[0] ?? src.length], "MULTIPLE_DOCS", "Source contains multiple documents"));
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

const yamlCompat = { parse, parseAllDocuments, parseDocument, stringify, LineCounter, Lexer, Parser, Composer, Document, Alias, Pair, Scalar, YAMLMap, YAMLSeq, YAMLParseError, YAMLWarning, isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar, isSeq };

export default yamlCompat;
