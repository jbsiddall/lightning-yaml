# API-PRIORITY.md — consumer needs → POC endpoints

The inverse view of [COMPATIBILITY.md](COMPATIBILITY.md): where that file maps
each endpoint to its consumer, this file maps each target consumer to the
endpoints it needs, at what priority, and whether the POC covers them. The
**Status** column is copied from COMPATIBILITY.md and must always agree with it —
a mismatch here is a bug in one of the two files.

The POC must satisfy the three real consumers (yaml-language-server, Prettier,
eslint-plugin-yml) at **P0 + P1** for it to be a credible drop-in. The convenience
tier is for library consumers who hand-build YAML documents from scratch.

**Priority legend**
- **P0** — the consumer can't function without it
- **P1** — an important feature of the consumer's normal workflow
- **P2** — nice-to-have; the consumer degrades gracefully without it

<!-- bench:none js-yaml:none yaml:2.9.0 ly:poc/yaml-results -->

## yaml-language-server

`yaml-language-server` is the bottleneck consumer for correctness: it powers
editor autocomplete, hover, validation, and document-outline over real user
files, so it needs the source-range-aware, error-reporting `Document` API
rather than a bare `parse`.

| Endpoint | Priority | Status | COMPATIBILITY.md ref |
|---|---|---|---|
| `parseDocument(src)` | P0 | SUPPORTED | High-level API |
| `parseAllDocuments(src)` | P1 | SUPPORTED | High-level API — multi-doc streams (e.g. bundled k8s) |
| `parse(src)` | P0 | SUPPORTED | High-level API |
| `LineCounter` | P0 | SUPPORTED | CST pipeline — offset→line/col for ranges [INFERRED: LSP positions are line/col, not offset] |
| `node.range` (all node classes) | P0 | SUPPORTED | via `Scalar`/`YAMLMap`/`YAMLSeq`/`Pair`/`Alias` |
| `doc.get` / `doc.getIn` | P0 | SUPPORTED | Document methods |
| `doc.has` / `doc.hasIn` | P1 | SUPPORTED | Document methods |
| `doc.toJS` / `doc.toJSON` | P0 | SUPPORTED | Document methods — document outline / hover value |
| `YAMLParseError` / `YAMLWarning` | P0 | SUPPORTED | Errors — diagnostics for validation |
| `version` option (1.1 merge-key + y/n bool) | P1 | PARTIAL | Options — 1.2 default; 1.1 subset |
| `customTags` | P0 | SUPPORTED | Options — user/k8s custom tags |
| `lineCounter` option | P1 | SUPPORTED | Options |

The `getIn` alias caveat (PARTIAL 4) affects only programmatic navigation through
aliased maps; hover/validation use ranges and `toJS`, which resolve aliases.

## Prettier

Prettier is the bottleneck consumer for fidelity: it round-trips files through a
**CST pipeline** and comment-aware **stringify**, so byte-stable output is the
hard requirement (see PARTIAL 5 on flow-collection comment placement).

| Endpoint | Priority | Status | COMPATIBILITY.md ref |
|---|---|---|---|
| `Parser` (CST) | P0 | SUPPORTED | CST pipeline |
| `Composer` (CST→AST) | P0 | SUPPORTED | CST pipeline |
| `stringify(doc)` | P0 | PARTIAL | High-level API — 8 of 9 corpus fixtures byte-identical |
| `doc.toString()` | P0 | SUPPORTED | Document methods — delegates to `stringify` |
| `stringifyCST` | P0 | SUPPORTED | CST pipeline |
| `LineCounter` | P1 | SUPPORTED | CST pipeline |
| `CST.*` namespace (token types/constants) | P1 | SUPPORTED | CST pipeline |
| `visitCST` | P1 | SUPPORTED | CST pipeline |
| `createScalarToken` / `resolveAsScalar` / `setScalarValue` | P1 | SUPPORTED | CST pipeline — CST editing utilities |
| `Scalar` / `YAMLMap` / `YAMLSeq` / `Pair` / `Alias` | P1 | SUPPORTED | Node classes |
| `isScalar` / `isMap` / `isSeq` / `isPair` / `isAlias` / `isNode` / `isCollection` / `isDocument` | P1 | SUPPORTED | Node classes & type guards |
| `visit` + `visit.SKIP` / `visit.BREAK` / `visit.REMOVE` | P1 | SUPPORTED | Visitor — printer traversal |
| `doc.get` / `doc.set` / `doc.setIn` / `doc.delete` / `doc.deleteIn` / `doc.add` / `doc.addIn` / `doc.clone` / `doc.createNode` | P1 | SUPPORTED | Document methods — programmatic build/modify |
| `keepSourceTokens` option | P1 | PARTIAL | Options — accepted; ranges cover position needs, CST tokens not attached |
| `YAMLParseError` / `YAMLWarning` | P1 | SUPPORTED | Errors |

`stringify` is the only P0 under a PARTIAL status. Its caveat is narrow: inline
comments *inside flow collections* detach on re-stringify (value-preserving;
block-collection comments attach correctly). Prettier's own yaml plugin drives
the low-level CST utilities, so the keepSourceTokens AST gap in COMPATIBILITY.md
does not block it.

## eslint-plugin-yml

`eslint-plugin-yml` runs lint rules over parsed ASTs and re-emits fixes, so it
needs the plain `parse` + AST over a comment-tolerant `visit`.

| Endpoint | Priority | Status | COMPATIBILITY.md ref |
|---|---|---|---|
| `parse(src)` | P0 | SUPPORTED | High-level API |
| `parseDocument(src)` | P0 | SUPPORTED | High-level API |
| `visit` on AST | P0 | SUPPORTED | Visitor |
| `isScalar` / `isMap` / `isSeq` | P0 | SUPPORTED | Node classes & type guards — rule dispatch |
| `doc.toJS` / `doc.toJSON` | P0 | SUPPORTED | Document methods — rule value access |
| `doc.set` / `doc.delete` | P1 | SUPPORTED | Document methods — autofixes rewrite values |
| `doc.createNode` (doc + standalone) | P1 | SUPPORTED | Document methods |
| `stringify(doc)` | P1 | PARTIAL | High-level API — re-serialize fixed files |
| `uniqueKeys` option | P1 | SUPPORTED | Options — duplicate-key linting |
| `Scalar` / `YAMLMap` / `YAMLSeq` / `Pair` | P1 | SUPPORTED | Node classes |
| `YAMLParseError` | P1 | SUPPORTED | Errors — rule error reporting |

## Convenience tier

For library consumers who construct or traverse YAML documents programmatically
rather than through one of the three named tools.

| Endpoint | Priority | Status | COMPATIBILITY.md ref |
|---|---|---|---|
| `createNode` (standalone) | P1 | SUPPORTED | Document methods |
| `visit` on plain JS values | P1 | SUPPORTED | Visitor |
| Core-schema tag resolution (`!!str`/`!!int`/`!!float`/`!!bool`/`!!null`) | P0 | SUPPORTED | Tags & schema |
| `merge` option + `<<` merge-key resolution in `toJS` | P1 | SUPPORTED | Options / Tags — docker-compose-style configs |
| `version: 1.1` merge-key + y/n booleans | P1 | PARTIAL | Options |

## Out of scope for the three consumers (still loud-throw in the POC)

These endpoints are explicitly cut: the POC throws `Not implemented in POC: …`
rather than silently misbehaving. None of the three consumers depend on them
[INFERRED: no consumer in COMPATIBILITY.md's Consumer column names them].

- `mapAsMap`, `intAsBigInt`, `reviver`, `stringKeys`, `prettyErrors` (parse)
- `lineWidth`, `flowLevel`, `defaultStringType`, `directives` (stringify)
- `visitAsync`
- `!!binary` (DEFERRED — loud-throw, planned for a later PR)

## Priority coverage vs the goal

Every endpoint the three consumers need at **P0** is SUPPORTED. Prettier's P0
`stringify` is the only P0 under PARTIAL, with a documented, value-preserving
caveat (flow-collection comments, COMPATIBILITY.md PARTIAL 5). The one P0-adjacent
gap is the `version: 1.1` option — PARTIAL (subset) but covering the
docker-compose merge-key + y/n-boolean shapes the project explicitly requires.