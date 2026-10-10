# `lightning-yaml/js-yaml` contract

See the [contract index](index.md) for the shared Dafny core/surface boundary
and the current proof status. This page records consumer behavior; none of its
complete public YAML operations are formally guaranteed yet.

This entry exports `load`, `loadAll`, `dump`, `YAMLException`, three tag-definition helpers, `Schema`, and four schema singletons. Its default object initially contains the same twelve named references and is an ordinary mutable object. The type-only exports are `Mark`, `TagDefinition`, `LoadOptions`, and `DumpOptions`.

## Calls, callbacks, and errors

| Call | Current behavior |
| --- | --- |
| `load(input, options?)` | Returns one value; empty input returns `null`. Syntax/engine errors become `YAMLException`, except `NotImplementedError`, which is rethrown unchanged. |
| `loadAll(input, iteratorOrOptions?, options?)` | Parses the full stream before invoking callbacks. Without a callback it returns the array. With a callback it calls once per document in order and returns `undefined`; callback returns are ignored. An iterator throw propagates unchanged. The callback is invoked without an explicit receiver: a strict-mode callback observes `this === undefined`, while a non-strict callback may coerce that receiver to the global object. Argument 2 wins over argument 3 when it is a non-null object, including an array; otherwise argument 3 supplies options. |
| `dump(value, options?)` | Validates options then returns the root writer's YAML string. Option failures are wrapped as `YAMLException`; writer failures are not wrapped. |

`YAMLException` extends `Error`; it has writable `name`, `reason`, and `mark` fields. A provided mark is retained by identity without shape validation, and an omitted/nullish mark gets a fresh placeholder with `buffer`, `column`, `line`, `name`, `position`, and `snippet`. Changing `reason` later does not update `message`. `toString(compact?)` ignores `compact` and reads the current name and message. Calling the class without `new` follows the native class `TypeError`; prototype and inherited `Error` behavior follow JavaScript.

The `load('') === null` behavior differs from upstream js-yaml v5. The source documents this choice, but the README's authoritative deviations list does not. Treat it as a pre-existing compatibility mismatch and documentation gap, not as an approved deviation. Root parse diagnostics converted to a mark contain a 0-based line/column parsed from the message, empty buffer/snippet, and position `-1`; non-parser errors receive the placeholder mark. Exact mark conversion and exception identity have regression gaps.

## Options, tags, and schemas

Option validation checks own enumerable string keys in order, invokes own getters, skips undefined values, and ignores nullish, primitive, and array bags.

| Entry | Accepted or ignored | Rejected |
| --- | --- | --- |
| `load`, `loadAll` | `filename` (used only to name a parse-error mark); `json: true`; `schema` equal by identity to the exported `CORE_SCHEMA`. | `json` except `true`; any other schema identity; every defined `maxAliases`, `maxDepth`, or `maxTotalMergeKeys`; unknown own keys. |
| `dump` | `CORE_SCHEMA`; falsy `sortKeys`, `noRefs`, `forceQuotes`, `seqNoIndent`, `seqInlineFirst`, `flowBracketPadding`, `flowSkipCommaSpace`, `flowSkipColonSpace`, `quoteFlowKeys`, and `tagBeforeAnchor`. | Any other schema; truthy values of those feature switches; every defined `skipInvalid`, `indent`, `flowLevel`, `lineWidth`, `quoteStyle`, or `transform`; unknown own keys. |

Undefined-valued options are skipped. `load`, `loadAll`, and `dump` ignore whole nullish, primitive, and array bags. For `loadAll`, a non-null object in position 2 wins and discards position 3; this includes arrays, which the shared validator then ignores. Otherwise position 3 supplies the options. This is the opposite of the `yaml` shim's defined-position-3 precedence. Unsupported enumerated values normally fail as `YAMLException`, subject to the prototype lookup defect: an own `__proto__` option can trigger a raw `TypeError`, while `toString` can yield a misleading rule error. This is an open defect.

The three `define*Tag` helpers allocate plain `{ tagName, nodeKind }` records with own writable enumerable fields and ignore their options argument (including any getter). `Schema` ignores constructor tags; `withTags` ignores its arguments and returns its exact receiver, including when borrowed and called with a non-Schema receiver. Calling the class without `new` follows native class behavior. The four schema constants are distinct singleton instances; only `CORE_SCHEMA` identity is accepted by option checks, and it does not change the parser's schema. These are import-compatibility stubs, not custom tag/schema support.

## Formal-contract status

The checked source ledger is [`public-surface-contract-manifest.json`](../../scripts/public-surface-contract-manifest.json), including individual default aliases, helper fields, options, overloads, constructors, and properties. Its behavior summaries are not complete executable method postconditions or event traces; the ledger lists the remaining gaps. Existing tests cover ESM source export shapes and aliases (`test/compat.unit.ts:47-79`) plus representative option and stream cases. [`test/built-package.test.mjs`](../../test/built-package.test.mjs) exercises built ESM entries, the root CommonJS entry, and CDN IIFE. These tests do not establish complete compatibility or formal proof; end-to-end error translation, callback, and host-object obligations remain pending.

`SurfaceOptions` is integrated with five routed selector/decision methods, six verified obligations, and ten rejected body mutations. The manifest records all 26 option-tranche constructs. The proofs are conditional on supplied JavaScript observations; they do not establish iterator effects, validation order, error identity, or parsing. `OwnRuleCode` is source-pinned, while the broad verifier selection emitted no verification condition for it. No complete public operation is proved.
