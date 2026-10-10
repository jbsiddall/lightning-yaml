# `lightning-yaml/yaml` contract

See the [contract index](index.md) for the shared Dafny core/surface boundary
and the current proof status. This page records consumer behavior; none of its
complete public YAML operations are formally guaranteed yet.

This entry provides a small compatibility surface for the `yaml` package. Its `parse`, `parseAllDocuments`, `parseDocument`, and `stringify` functions are also present on the mutable default object as the same initial function references. `Reviver` and `CompatDocument` are type-only exports.

## Parsing and document wrappers

| Call | Current behavior |
| --- | --- |
| `parse(src, reviverOrOptions?, options?)` | Parses one document; empty input returns `null`; a second document throws the original `YAMLParseError`. A function in argument 2 is the reviver. Otherwise argument 2 is promoted to options only when truthy and argument 3 is exactly `undefined`; a defined argument 3 wins. |
| `parseAllDocuments(src, options?)` | Success returns one minimal wrapper per document; empty stream returns `[]`. On parse failure it returns one wrapper with `contents: undefined`, the thrown `Error` in `errors` unchanged (or `new Error(String(value))` for a non-`Error` throw), and `warnings: []`; it does not return a partial document prefix. |
| `parseDocument(src, options?)` | Success returns a wrapper with empty `errors` and `warnings`. On failure it returns one wrapper holding the error and attempts to retain the first document for the multiple-document case. |

Each wrapper is an ordinary mutable object with own writable `contents`, `errors`, and `warnings` data properties and own `toJS()` and `toJSON()` functions. Both functions return the value captured when the wrapper was created, even if `contents` is later reassigned. There is no custom `toString`; normal `Object.prototype` behavior applies. This is not a YAML AST/CST Document implementation.

The reviver walks object keys bottom-up and array indices from zero through the current length, then calls once for the root with key `''`. Its `this` is the parent container (or a synthetic root holder). Returning `undefined` deletes an object property or leaves an array hole; it does not splice. Callback throws propagate unchanged. Parsed YAML aliases can form cycles, while the reviver has no visited-set guard; stack exhaustion for such a graph is a known untested behavior. The walk uses ordinary property reads, writes, and deletes, so accessors and proxies can run user code or throw during traversal.

## Options and errors

Option bags are checked by own enumerable string keys in JavaScript key order. Nullish bags, primitive bags, and arrays are ignored by the shared validator; undefined-valued options are skipped. Own getters are read and can throw.

| Entry | Accepted or ignored | Rejected |
| --- | --- | --- |
| `parse`, `parseAllDocuments`, `parseDocument` | `schema: 'core'`; `version: '1.2'`; any defined `prettyErrors` (no-op); falsy `mapAsMap`, `intAsBigInt`, `uniqueKeys`, `stringKeys`, and `merge`. | Non-default schema/version; truthy feature switches; any defined `maxAliasCount`, `customTags`, `resolveKnownTags`, `keepSourceTokens`, `lineCounter`, or `onAnchor`; unknown own keys. Rejection is a private `YAMLCompatError` before parse/capture logic. Parse failures from `parse` remain the original error. |
| `stringify` | `schema: 'core'`; `version: '1.2'`; falsy `sortMapEntries`. | Every defined `singleQuote` value, including `false`; truthy `sortMapEntries`; every defined `indent`, `nullStr`, `trueStr`, `falseStr`, `indentSeq`, `directives`, `lineWidth`, `minContentWidth`, `blockQuote`, `collectionStyle`, `flowCollectionPadding`, `aliasDuplicateObjects`, `anchorPrefix`, or `customTags`; unknown own keys; every replacer. |

Undefined-valued named options are skipped. A falsy second stringify argument is absent; a two-argument function or array is treated as a replacer and rejected. A defined third argument takes precedence. A third-position array is ignored by option validation; a non-null primitive in the option slot is rejected (number/string report unsupported JSON-style indent; other primitives report that options must be an object). Parse uses the same argument-3 precedence, but scalar option bags are ignored by the shared validator.

`validateOptions` indexes a normal object-literal rule table by property key. Consequently an own `__proto__` key can resolve to inherited `Object.prototype` and produce a native `TypeError`; inherited names such as `toString` can also resolve unexpectedly. This is a pre-existing open defect, not an approved option behavior. README's broad statement that unsupported options always throw a compatibility error is not exact for ignored bags, undefined values, or this prototype case.

## Formal-contract status

The source-derived coverage ledger is [`public-surface-contract-manifest.json`](../../scripts/public-surface-contract-manifest.json). It tracks each export, type, wrapper property/method, option field/rule, overload mode, and default alias. Its behavior summaries are not complete executable method postconditions or event traces; the ledger lists the remaining gaps. Presence in the ledger does not prove the route or its JavaScript host effects. End-to-end reviver, parsing, and wrapper proofs remain pending.

The integrated `SurfaceOptions` module contains five routed selector/decision methods with conditional proofs (six obligations; ten altered-body mutations are rejected). The 26 recorded option-tranche constructs are present. These proofs depend on supplied JavaScript observations and do not establish key enumeration, getter/proxy behavior, error construction, or YAML parsing; no complete public operation is proved.
