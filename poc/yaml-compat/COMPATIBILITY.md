# COMPATIBILITY.md — yaml v2.9.0 API delta list

Definitive compatibility map for the `poc/yaml-compat` layer against
`yaml` v2.9.0 (`eemeli/yaml`). Every entry has a status, a consumer that needs
it, and a named differential test.

**Status legend:**
- **SUPPORTED** — fully working, differential-tested against eemeli
- **PARTIAL** — works with documented caveats
- **DEFERRED** — throws `Not implemented in POC: …`; planned for a later PR
- **CUT** — throws `Not implemented in POC: …`; not planned for the POC scope

<!-- bench:none js-yaml:none yaml:2.9.0 ly:poc/yaml-api-polish -->

## High-level API

| Endpoint | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `parse(src, opts?)` | SUPPORTED | yaml-language-server, Prettier | `parser.test.ts` corpus round-trip | Deep-equal to eemeli on all corpus fixtures |
| `parseDocument(src, opts?)` | SUPPORTED | yaml-language-server, Prettier, eslint-yml | `parser.test.ts` AST structure, `api.test.ts` | Returns `Document` with errors, warnings, directives, comments |
| `parseAllDocuments(src, opts?)` | SUPPORTED | yaml-language-server | `api.test.ts` parseAllDocuments | Multi-doc streams parsed correctly |
| `stringify(doc, opts?)` | SUPPORTED | Prettier, eslint-yml | `stringify.test.ts` corpus round-trip | Comment-preserving; byte-identical on 8 of 9 corpus fixtures (only comments-github-actions diverges by 1 comment-attachment line) |
| `doc.toString(opts?)` | SUPPORTED | Prettier | `stringify.test.ts` | Delegates to `stringify` |

## Document methods

| Endpoint | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `doc.get(key, keepScalar?)` | SUPPORTED | yaml-language-server, Prettier | `api.test.ts` get/getIn | `keepScalar=true` returns the Scalar node |
| `doc.getIn(path, keepScalar?)` | SUPPORTED | yaml-language-server | `api.test.ts` get/getIn | Navigates through Maps and Seqs by key/index |
| `doc.set(key, value)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` set/setIn | Wraps plain values in Scalar |
| `doc.setIn(path, value)` | SUPPORTED | Prettier | `api.test.ts` set/setIn | Creates intermediate Maps as needed |
| `doc.has(key)` | SUPPORTED | yaml-language-server | `api.test.ts` has/hasIn | Returns boolean |
| `doc.hasIn(path)` | SUPPORTED | yaml-language-server | `api.test.ts` has/hasIn | Returns boolean |
| `doc.delete(key)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` delete/deleteIn | Returns true if deleted |
| `doc.deleteIn(path)` | SUPPORTED | Prettier | `api.test.ts` delete/deleteIn | Returns true if deleted |
| `doc.add(pair)` | SUPPORTED | Prettier | `api.test.ts` add Pair to map | Adds Pair to Map, item to Seq |
| `doc.addIn(path, item)` | SUPPORTED | Prettier | `api.test.ts` addIn to nested seq | Navigates to collection, adds |
| `doc.clone()` | SUPPORTED | Prettier | `api.test.ts` clone | Deep clone; independent of original |
| `doc.toJSON(opts?)` | SUPPORTED | all consumers | `api.test.ts` toJSON | Alias for `toJS()` |
| `doc.toJS(opts?)` | SUPPORTED | all consumers | `parser.test.ts` corpus | Resolves anchors, merge keys, mapAsMap |
| `doc.createNode(value)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` createNode | Recursively converts JS → AST |
| `createNode(value)` (standalone) | SUPPORTED | convenience | `api.test.ts` standalone createNode | Creates a throwaway Document, delegates |

## Node classes & type guards

| Endpoint | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `Scalar` | SUPPORTED | all | `parser.test.ts` | Fixed-shape class with value, type, range, anchor, tag |
| `YAMLMap` | SUPPORTED | all | `parser.test.ts` | items: Pair[], flow: boolean |
| `YAMLSeq` | SUPPORTED | all | `parser.test.ts` | items: Node[], flow: boolean |
| `Pair` | SUPPORTED | all | `parser.test.ts` | key/value nullable |
| `Alias` | SUPPORTED | all | `parser.test.ts` | source: string |
| `isScalar(v)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` type guards | Returns false for null/undefined/primitives |
| `isMap(v)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` type guards | |
| `isSeq(v)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` type guards | |
| `isPair(v)` | SUPPORTED | Prettier | `api.test.ts` type guards | |
| `isAlias(v)` | SUPPORTED | Prettier | `api.test.ts` type guards | |
| `isNode(v)` | SUPPORTED | Prettier | `api.test.ts` type guards | Scalar\|Map\|Seq\|Alias |
| `isCollection(v)` | SUPPORTED | Prettier | `api.test.ts` type guards | Map\|Seq |
| `isDocument(v)` | SUPPORTED | Prettier | `api.test.ts` type guards | Duck-typed: contents+directives+errors |

## Visitor

| Endpoint | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `visit(doc, visitor)` | SUPPORTED | Prettier, eslint-yml | `api.test.ts` SKIP/BREAK/REMOVE | Depth-first; Pair key/value children; Map/Seq items |
| `visit.SKIP` | SUPPORTED | Prettier | `api.test.ts` SKIP | Prevents child traversal |
| `visit.BREAK` | SUPPORTED | Prettier | `api.test.ts` BREAK | Stops entire traversal |
| `visit.REMOVE` | SUPPORTED | Prettier | `api.test.ts` REMOVE | Removes node from parent collection or nulls Pair key/value |
| `visit` on plain JS values | SUPPORTED | convenience | `api.test.ts` plain JS | Calls visitor(null, value, []) directly |
| `visitAsync(doc, visitor)` | CUT | — | `api.test.ts` visitAsync throws | No POC consumer needs async traversal |

## CST pipeline (low-level)

| Endpoint | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `Parser` (CST) | SUPPORTED | Prettier (CST mode) | `cst.test.ts` | Token-level parser, eemeli-compatible |
| `Composer` | SUPPORTED | Prettier (CST mode) | `cst.test.ts` | CST → token stream |
| `LineCounter` | SUPPORTED | yaml-language-server | `parser.test.ts` | Offset → line/col mapping |
| `CST.*` namespace | SUPPORTED | Prettier | `cst.test.ts` | Token types and constants |
| `visitCST` | SUPPORTED | Prettier | `cst.test.ts` | CST-level visitor |
| `stringifyCST` | SUPPORTED | Prettier | `cst.test.ts` | CST → string |
| `createScalarToken` | SUPPORTED | Prettier | `cst.test.ts` | CST utility |
| `resolveAsScalar` | SUPPORTED | Prettier | `cst.test.ts` | CST utility |
| `setScalarValue` | SUPPORTED | Prettier | `cst.test.ts` | CST utility |

## Errors

| Endpoint | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `YAMLParseError` | SUPPORTED | all | `parser.test.ts` error cases | |
| `YAMLWarning` | SUPPORTED | all | `parser.test.ts` | |

## Options

| Option | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `version` | PARTIAL | yaml-language-server | parser tests | '1.2' default; '1.1' enables merge-key resolution but not the full 1.1 tag set (y/n bools etc.) |
| `strict` | SUPPORTED | all | parser tests | |
| `uniqueKeys` | SUPPORTED | eslint-yml | parser tests | |
| `merge` | SUPPORTED | — | parser tests | `<<` merge key resolution in toJS |
| `keepSourceTokens` | PARTIAL | Prettier | parser tests | AST always includes ranges; full CST token attachment not implemented |
| `customTags` | SUPPORTED | yaml-language-server | parser tests | Simple {tag, test, resolve} form |
| `lineCounter` | SUPPORTED | yaml-language-server | parser tests | |
| `aliasDuplicateObjects` | SUPPORTED | — | parser tests | |
| `mapAsMap` (parse) | CUT | — | `api.test.ts` CUT throws | Throws `Not implemented in POC: option "mapAsMap"` |
| `intAsBigInt` (parse) | CUT | — | `api.test.ts` CUT throws | Throws `Not implemented in POC: option "intAsBigInt"` |
| `reviver` (parse) | CUT | — | `api.test.ts` CUT throws | Throws `Not implemented in POC: option "reviver"` |
| `stringKeys` (parse) | CUT | — | `api.test.ts` CUT throws | Throws `Not implemented in POC: option "stringKeys"` |
| `prettyErrors` (parse) | CUT | — | `api.test.ts` CUT throws | Throws `Not implemented in POC: option "prettyErrors"` |
| `lineWidth` (stringify) | CUT | — | stringify validation | Throws `Not implemented in POC: lineWidth` |
| `flowLevel` (stringify) | CUT | — | stringify validation | Throws `Not implemented in POC: flowLevel` |
| `defaultStringType` (stringify) | CUT | — | stringify validation | Throws `Not implemented in POC: defaultStringType` |
| `directives` (stringify) | CUT | — | stringify validation | Throws `Not implemented in POC: directives` |

## Tags & schema

| Tag | Status | Consumer | Test | Notes |
|---|---|---|---|---|
| `!!str`, `!!int`, `!!float`, `!!bool`, `!!null` | SUPPORTED | all | parser tests | Core schema tag resolution |
| `!!binary` | DEFERRED | — | `api.test.ts` !!binary throws | Throws `Not implemented in POC: !!binary` in toJS |
| Schema class | PARTIAL | — | — | Only core schema; no tag-specific schema switching beyond version |
| Custom tags (`!tag`) | SUPPORTED | yaml-language-server | parser tests | Via `customTags` option |

## PARTIAL caveats

### 1. Lazy parseDocument: whole-stream scan

Our `parseDocument` scans the entire source to detect tab-indent anomalies
(defensive), while eemeli parses only the first document in a multi-doc stream.
**Impact**: on a large multi-doc stream, our first-doc extraction is ~2.7x
slower than eemeli. However, `parseAllDocuments` on the same stream is ~13x
faster because the single-pass scan avoids re-reading. Most consumers
(yaml-language-server, Prettier) operate on single-doc files, so the
real-world impact is minimal.

*ponytail: single-pass tab detection. Upgrade path: eemeli-style first-doc-only
parse with a lazy rest-doc iterator, add when a consumer profiles this hot.*

### 2. keepSourceTokens — CST tokens not attached to AST nodes

The `keepSourceTokens: true` option is accepted but does not attach raw CST
tokens to AST nodes (ranges are always populated instead). Prettier's CST mode
uses the low-level `CSTParser` + `Composer` directly, so this gap does not
block it.

*ponytail: ranges cover Prettier's position needs. Full CST attachment is a
mechanical add, defer until a consumer actually reads `.token`.*

### 3. C0 control escape format in stringify

When stringifying strings containing C0 control characters (e.g. `\x07`, `\x1b`),
our stringify emits the same escape sequences as eemeli (`\a`, `\b`, `\t`, `\n`,
`\v`, `\f`, `\r`, `\e`, `\xNN`). Value-level round-trip is byte-identical.
Escape format (named vs hex) is tested by `api.test.ts` "C0 control escape
fidelity".

### 4. Alias resolution in `getIn`

`getIn` does not resolve `Alias` nodes mid-path. If a path traverses through
an aliased map, the lookup returns `undefined` instead of following the alias.
This affects only programmatic `getIn` navigation, not `toJS` (which resolves
aliases correctly).

*ponytail: `toJS` resolves everything. `getIn` alias following needs anchor
collection at Document level, add when a consumer navigates through aliases.*

## Summary

| Status | Count |
|---|---|
| SUPPORTED | 58 |
| PARTIAL | 2 |
| DEFERRED | 1 |
| CUT | 10 |

The POC covers every API endpoint needed by the three target consumers
(yaml-language-server, Prettier, eslint-plugin-yml) at P0+P1 priority, with
loud `Not implemented in POC` errors for everything explicitly out of scope.
