# yaml compatibility testing experiment

This campaign compares `lightning-yaml/yaml` with pinned `yaml@2.9.0`.
It shares the existing isolated fast-check/zod-fast-check package, graph comparator,
generators and CLI argument parser with the js-yaml experiment.

## Intended layer and branch status

The current project goal is a source-aware CST/document/node API usable by
`yaml-language-server`. The corresponding draft implementation is in the
[CST PR #182](https://github.com/jbsiddall/lightning-yaml/pull/182) stack,
with the latest cumulative source in [PR #184](https://github.com/jbsiddall/lightning-yaml/pull/184).
Those drafts have not merged. The value-oriented shim described below is on `main`.
The older [compatibility epic #104](https://github.com/jbsiddall/lightning-yaml/issues/104)
defers AST/CST support, so it does not describe this newer goal.

<!-- ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

## Source-aware CST comparison

`pnpm gen:yaml-cst-candidate` extracts only the draft's TypeScript source at
`6a25ef63d6d9d5114515660ecc25a06542af6647` into an ignored scratch directory.
The source hash is verified before loading. It does not change the installed library.
Then run `pnpm audit:yaml-cst:full` or a shorter
`pnpm audit:yaml-cst --samples 200 --seed 20261011`.

The differential pipeline is the actual public `Parser → Composer` API with
`strict:false` and `keepSourceTokens:true` on both implementations. Tests observe
CST token kinds, nesting, source, ordering and offsets; reconstruction through
`CST.stringify`; document/node ranges, comments, tags, anchors and source tokens;
diagnostics; converted value graphs; and UTF-16 line positions, including CRLF.
Matching converted values cannot establish source-aware compatibility.
Missing APIs on `main` are reported separately from the draft's behavior.

The fast-check tests exercise a bounded mapping grammar and source-aware regression
fixtures. The audit adds the pinned corpus and a larger generated schedule.
Worker deadlines record time-budget failures; they do not prove nontermination. Reports live in
`results/yaml-cst-properties/` and are included in the CI artifact.
No result proves compatibility for every input or integration with the language server.

## The implemented subset

The compatibility shim is already on `origin/main`, including the initial
[shim commit](https://github.com/jbsiddall/lightning-yaml/commit/1b1828c9)
and the subsequent [option validation PR](https://github.com/jbsiddall/lightning-yaml/pull/117).
It exposes `parse`, `stringify`, `parseDocument`, and `parseAllDocuments`.
This is partial compatibility with selected calls, rather than the full package API.

<!-- yaml:2.9.0 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

| Surface            | Current implementation                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `parse`            | Core parsing and a positional reviver                                                      |
| `stringify`        | Core serialization; replacers and custom formatting mostly rejected                        |
| Document factories | Minimal wrappers with `contents`, `errors`, `warnings`, `toJS()` and `toJSON()`            |
| `contents`         | Plain JavaScript value; the reference provides an AST node                                 |
| Options            | Default core schema/version and selected inactive flags; unsupported defined options throw |
| Other package APIs | AST/CST classes, visitors, constructors and document editing APIs are absent               |

<!-- yaml:2.9.0 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

The campaign measures behavior without changing that implementation. A reference
mismatch is a candidate for investigation; the YAML specification remains the
project's authority on correctness.

## Run

From the repository root, install the root and isolated dependencies, then run:

```sh
pnpm --dir experiments/js-yaml-properties install --frozen-lockfile --strict-peer-dependencies
pnpm gen:suite
pnpm gen:yaml-cst-candidate
pnpm test:properties
pnpm test:coverage
pnpm audit:yaml:full
```

For shorter runs or a saved failure:

```sh
pnpm audit:yaml --samples 200 --extended --seed 20261011
pnpm audit:yaml:strict --samples 200
pnpm audit:yaml:replay /absolute/path/to/case.json --strict
```

Normal audit mode records baseline gaps and exits successfully after a completed
campaign. Strict mode fails when any observed discrepancy remains. The shared
argument parser rejects invalid flags and sample counts. The audit does not
shrink failures; recorded descriptors replay the original cases.

## What the comparison observes

- Parse results: scalar values, exact object brands, sparse arrays, aliases and cycles.
- Stringify: return contract and exact output text, plus both outputs decoded by the
  reference under the applicable schema. Decode failures and call failures have
  their own denominators.
- Document factories: document count, converted values, error and warning records,
  and the distinct AST surface. Matching conversions do not imply AST compatibility.
- Callback recipes and overloads: bounded witnesses, not arbitrary JavaScript functions.
- Option fields: declaration inventory checked against the pinned reference types,
  with omission and explicit undefined distinct from activated options.
- Static API inventory: present/missing runtime export names, separate from behavior.

Graph comparison preserves exact brands and bidirectional object identity. Node
Buffers are compared by visible bytes, Buffer brand and object identity; pooled
backing storage and offsets are excluded. Other built-in typed arrays retain
backing-buffer identity checks. Accessors, symbol keys and opaque objects are
outside the graph transport's supported domain.

## Finite option bases and remaining limits

The extended campaign enumerates three independent finite bases:

| Basis              | Fields/domains                                                                                                                                                | Assignments |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------: |
| Parse booleans     | intAsBigInt, keepSourceTokens, prettyErrors, strict, stringKeys, uniqueKeys, merge, resolveKnownTags, mapAsMap                                                |         512 |
| Stringify booleans | aliasDuplicateObjects, flow, keepUndefined, doubleQuotedAsJSON, flowCollectionPadding, indentSeq, simpleKeys, trailingComma, verifyAliasOrder, sortMapEntries |       1,024 |
| Stringify enums    | blockQuote(false/true/folded/literal), collectionStyle(any/block/flow), singleQuote(false/true/null), directives(false/true/null)                             |         108 |

<!-- yaml:2.9.0 -->

These bases are exhaustive over their stated domains. They are not multiplied by
every schema, numeric option, callback, document method or input. Single-option
and interaction witnesses supplement them. A rejected candidate option counts as
a call/semantic gap; that case does not exercise its formatting or parsing paths.

Generated containers are bounded. Corpus variants may repeat YAML text. Custom
callbacks, schemas, tags, document mutations and the full AST/CST API remain
unbounded or unexercised. Cyclic inputs with disabled alias handling or recursive
revivers are excluded. No sampled percentage establishes universal equivalence
or estimates the fraction of all `yaml` behavior supported. The `onTagObj` witness
does not activate its reference callback and is not behavioral coverage.
`Document.toJSON(key,onAnchor)` and cross-document AST identity are not tested.
Converted values are compared together across the document stream; AST identity
is observed within each document.

## Reports and code coverage

The yaml audit writes to `results/yaml-properties/`:

- `manifest.json`: pins, seed, revision, corpus hashes and scheduling limits.
- `summary.json`: metrics with numerators and denominators.
- `coverage.json`: operation/source/family breakdown, matrix counts and option ledger.
- `cases.jsonl` and `failures.jsonl`: replayable graph-encoded cases.

All campaigns' property/model tests run under `pnpm test:coverage`, alongside the
existing assertions. All production `src/**/*.ts` files count, even at zero hits.
The audit CLI is separate from the code coverage run.

The combined HTML Vitest report, JUnit, HTML coverage, JSON summary and LCOV stay
under `results/js-yaml-properties/`. Serve the interactive Vitest report with:

```sh
pnpm exec vite preview --outDir results/js-yaml-properties/vitest
```

The workflow uploads all report directories in the existing
`js-yaml-properties-and-coverage` artifact. Code coverage measures executed
production code; compatibility metrics measure the bounded schedule of observations.

## Latest measured run

See [the measured results](MEASURED.md) for main-wrapper and draft CST
observations, independent denominators, time-budget failures and production coverage.
