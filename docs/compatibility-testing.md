# js-yaml compatibility testing

This branch adds tests around the implementation inherited from `origin/main`.
The parser and compatibility shim are unchanged. The current reference is
pinned to js-yaml **5.4.3**, whose API differs from v4. The recorded
2026-10-11 report below is a historical run against js-yaml 5.2.1.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm test
pnpm test:properties
pnpm test:coverage
```

<!-- js-yaml:5.4.3 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

The compatibility harness is a private workspace package with pinned Zod 3 and
fast-check 3 dependencies for `zod-fast-check`; the application keeps root Zod 4.
`@fast-check/vitest` runs generated properties, and `ZodFastCheck().inputOf()`
supplies scalar arbitraries used in the campaign.

<!-- js-yaml:5.4.3 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

The full audit uses seed `20261011`, generates 20,000 YAML-text trials and
20,000 value-graph trials, adds the pinned corpus and effect-triggering fixtures,
and enumerates every assignment of the eleven dump booleans (including
`sortKeys`) and two quote styles. That finite basis has 4,096 configurations.
Each runs on a mapping containing quoted strings, sequences and a shared DAG.
This does **not** enumerate their cross-product with every schema, numeric value,
callback and input. Single-option and targeted interaction fixtures supplement
that basis; options outside it are sampled.

```sh
pnpm audit:js-yaml --samples 200 --extended --seed 20261011
pnpm audit:js-yaml --samples 100000 --extended --output /tmp/large-audit
pnpm audit:js-yaml:strict --samples 200
pnpm audit:js-yaml:replay /absolute/path/to/case.json
```

`case.json` is one descriptor or one line extracted from `failures.jsonl`.
Replay returns a fresh comparison report; add `--strict` to fail when the gap
persists. Corpus setup is unnecessary for replay. Unknown flags, missing values,
incomplete execution, missing corpus files and harness exceptions fail the run.
Normal audit mode exits successfully after recording existing compatibility gaps.
`--samples` accepts 0–200,000 generated trials **per operation**. No shrinking is
performed by the audit; its saved descriptors replay the original failures.

## What is exercised

| Surface            | Exercised                                                                                                                                                    | Limits                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `load`             | Valid/invalid syntax, schema typing, aliases/cycles, duplicate keys, diagnostics                                                                             | Bounded generators and fixed corpus                                                                                 |
| `loadAll`          | Array return, null + third options, iterator, iterator throws, second-object precedence                                                                      | Fixed signature witnesses; arbitrary callback behavior unbounded                                                    |
| `dump`             | Exact bytes and reference-decoded graph semantics, schema/formatting options, typed values, sharing/cycles                                                   | Cyclic `noRefs` combinations and nonterminating callbacks are not scheduled                                         |
| Values             | null, undefined, boolean, number incl NaN/infinities/−0, string, arrays/holes, ordinary/null-prototype objects, Date, binary views/buffers, Map, Set, RegExp | Random values use bounded JSON-like containers; other brands are fixed sentinels/model regressions                  |
| Reference topology | Distinct vs shared objects, DAGs, cycles and shared backing buffers                                                                                          | Own enumerable data properties; accessors, symbol keys and opaque/subclassed objects are rejected by graph encoding |
| Schemas/tags       | Four built-in schemas, omitted schema, one custom scalar tag                                                                                                 | Custom sequence/mapping tags, tag prefixes and arbitrary schema callbacks remain untested                           |
| Legacy v4 options  | Separate ignored-option probes for listener, onWarning, styles, replacer                                                                                     | Not counted as v5 supported option names                                                                            |

Every declared v5 option below has a scheduled witness. Compile-time inventory
checks fail on missing or extra fields in the pinned reference declarations.
This is **option-name coverage**, not proof that all behavior of an option is covered.

### Pinned real-world inputs

Normal corpus campaigns append three byte-preserved examples from Kubernetes,
Docker Awesome Compose, and GitHub Actions. Their immutable source commits, local
paths, byte counts, SHA-256 hashes, SPDX identifiers, and separately pinned
license files are recorded in `test/corpus/real-world/manifest.json`; attribution
and license copies are beside it. The old YAML Test Suite snapshot remains an
independently validated input set. The composed loader validates both sets and
then appends the additions in manifest order.

Each added file always receives `load` and `loadAll-array` descriptors. An
additional reference-derived `dump` descriptor is scheduled when the reference
accepts its value and the graph codec can transport it. The bounded properties
also run the exact source bytes and LF/CRLF forms through reference and candidate
single and stream parsers, then check serialization by parsing it with the
corresponding reference. These examples add input files to metric denominators;
descriptor counts remain separate because each input has multiple operation rows.
The js-yaml manifest keeps its existing repeated `corpus` descriptor rows and
adds `corpusInputFiles` for the unique input-file summary.
Replay does not schedule a corpus and reports that explicitly. Historical reports
continue to describe the corpus and schedule used when they were produced.

| Parse option      | Witness family                                         |
| ----------------- | ------------------------------------------------------ |
| filename          | Empty/ordinary/Unicode names, syntax-error diagnostics |
| schema            | Omitted, built-in schemas and custom scalar            |
| json              | Explicit undefined/false/true, duplicate mapping keys  |
| maxDepth          | Negative/zero/ordinary values and nested collections   |
| maxAliases        | Negative/zero/ordinary values and repeated aliases     |
| maxTotalMergeKeys | Negative/zero/ordinary values and merge syntax         |

| Dump option        | Witness family                                                 |
| ------------------ | -------------------------------------------------------------- |
| schema             | Omitted, built-in schemas and custom scalar                    |
| indent             | Undefined/negative/zero/ordinary widths and nested collections |
| seqNoIndent        | Undefined/false/true and finite boolean matrix                 |
| seqInlineFirst     | Undefined/false/true and finite boolean matrix                 |
| sortKeys           | Undefined/false/true, ascending/descending comparators         |
| lineWidth          | Undefined/negative/zero/ordinary widths and a long scalar      |
| flowBracketPadding | Undefined/false/true and finite boolean matrix                 |
| flowSkipCommaSpace | Undefined/false/true and finite boolean matrix                 |
| flowSkipColonSpace | Undefined/false/true and finite boolean matrix                 |
| quoteFlowKeys      | Undefined/false/true and finite boolean matrix                 |
| quoteStyle         | Undefined/single/double and finite boolean matrix              |
| forceQuotes        | Undefined/false/true and finite boolean matrix                 |
| tagBeforeAnchor    | Undefined/false/true and finite boolean matrix                 |
| skipInvalid        | Undefined/false/true, functions/symbols/undefined in a mapping |
| noRefs             | Undefined/false/true, shared DAG                               |
| flowLevel          | Undefined/negative/zero/ordinary values and nested collections |
| transform          | Identity, contents mutation and controlled exception           |
| scalarStyleRules   | Omitted/undefined, empty/default rules, activated quoted output and controlled exception |

`scalarStyleRules` recipes store names and fixed behaviors, not functions.
Replay rebuilds a bounded ordered callback array and records its calls. The
activated rule targets scalar values in simple and multiline fixtures; arbitrary
or recursive callback behavior is not sampled. The runtime export inventory
also reports candidate-only and reference-only names separately from option
behavior and declaration checks.

## Interpret the reports

Each audit directory under `results/compatibility/` contains:

- `summary.json`: numerators, denominators and percentages for each metric.
- `coverage.json`: separate operation/source/family metrics, finite matrix counts,
  duplicates and per-option witness ledger.
- `manifest.json`: seed, runtime/dependencies, source revision, corpus provenance
  and SHA256s, caps and dump eligibility.
- `cases.jsonl` / `failures.jsonl`: replayable descriptors and graph-encoded outcomes.

A graph comparison uses `Object.is` for scalar values and a bidirectional identity
mapping for objects. JSON equality is insufficient: it loses NaN, undefined,
types, aliases and cycles. Each dump receives an independent instance of its input.
Dump semantics compare **both outputs parsed by js-yaml**, accounting for the
reference's own transformations and `noRefs`; they do not compare against the
unmodified input. If reference output cannot be decoded under its schema, that
case is excluded only from the semantic metric and remains in byte/call metrics.
Candidate failures are counted as semantic gaps whenever the reference oracle is
available. Both throwing is not full parity: error details and callback effects
are reported separately.

`dumpByteDifferences` counts unequal strings; `dumpByteCallFailures` counts absent
candidate strings, with the same reference-success denominator. The conditional
both-success byte metric is also reported. Do not interpret zero unequal strings
as agreement when every candidate call failed.

Trials are weighted by the schedule; repeated inputs are reported as duplicates.
Source buckets let you inspect default generated inputs, corpus inputs, option
probes and the exhaustive finite matrix independently. Family buckets overlap.
No percentage estimates the fraction of **all** YAML or all possible js-yaml behavior.

## Code coverage and Vitest report

`pnpm test:coverage` runs existing Vitest tests, existing node:test assertion bodies
and the new property/model tests in one Vitest runner. The dedicated setup maps the
existing suites' simple `node:test` registrations to Vitest; their standalone Node
commands remain available. It does not include the separate conformance CLI audit.
All production `src/**/*.ts` files count, even at zero hits; the file-inventory
check fails if one disappears. Only declaration files (`*.d.ts`) would be excluded.
No production coverage threshold is invented for this initial measurement.

- HTML Vitest: `results/compatibility/vitest/index.html`
- JUnit: `results/compatibility/vitest/junit.xml`
- HTML coverage: `results/compatibility/coverage/index.html`
- JSON summary / LCOV: the same coverage directory.

Serve the interactive Vitest report using:

```sh
pnpm exec vite preview --outDir results/compatibility/vitest
```

The workflow uploads all reports as `compatibility-test-reports`, including
reports produced before a failing step. Line/branch coverage measures executed
production code. The compatibility audit measures sampled observable behavior.
They are independent measurements.

## Recorded run

[Measured results for 2026-10-11](compatibility/reports/2026-10-11/js-yaml.md) are a
historical js-yaml 5.2.1 run; they include the initial coverage percentages and
the separate corpus, generated-input and option-matrix gaps.

## yaml compatibility campaign

The same workspace installation also runs the yaml campaign, with a separate
reference and report directory. `pnpm test:properties` and
`pnpm test:coverage` include both sets of harness tests. CST candidate tests require explicit candidate setup with `pnpm gen:yaml-cst-candidate`
and run through `pnpm test:yaml-cst`.

Node Buffers are compared and transported by their visible bytes, exact Buffer
brand and object identity. Their ambient pooled backing storage and offsets are
excluded; other built-in typed arrays retain backing-buffer identity checks.


# yaml compatibility testing

This campaign compares `lightning-yaml/yaml` with pinned `yaml@2.9.0`.
It shares the private fast-check/zod-fast-check workspace package, graph
comparator, generators and CLI argument parser with the js-yaml campaign.

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
`results/compatibility/cst/` and are included in the CI artifact.
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

From the repository root, install once, then run the default checks:

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm test
pnpm test:properties
pnpm test:coverage
pnpm gen:suite
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

Normal corpus runs include the unchanged pinned YAML Test Suite plus the three
official Kubernetes, Docker Compose, and GitHub Actions examples described above.
The explicit manifest and license copies live in `test/corpus/real-world/`.
Both sets are validated independently before their inputs are composed. Each new
input always receives `parse`, `parseDocument`, and `parseAllDocuments`; reference
accepted values also receive `stringify` when graph transport supports them. The
small fixed-seed properties use each exact upstream byte sequence, then bounded
LF/CRLF variants, and compare semantic graphs after serialization. They do not
require document AST or emitted-text equality. New files change input-based
denominators; scheduled descriptor counts are reported separately. Replays report
that no corpus was scheduled, and frozen historical reports retain their original
corpus meaning.

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

The yaml audit writes to `results/compatibility/yaml/`:

- `manifest.json`: pins, seed, revision, corpus hashes and scheduling limits.
- `summary.json`: metrics with numerators and denominators.
- `coverage.json`: operation/source/family breakdown, matrix counts and option ledger.
- `cases.jsonl` and `failures.jsonl`: replayable graph-encoded cases.

Both compatibility campaigns' property/model tests run under `pnpm test:coverage`, alongside the
existing assertions. All production `src/**/*.ts` files count, even at zero hits.
The audit CLI is separate from the code coverage run.

The combined HTML Vitest report, JUnit, HTML coverage, JSON summary and LCOV stay
under `results/compatibility/`. Serve the interactive Vitest report with:

```sh
pnpm exec vite preview --outDir results/compatibility/vitest
```

The workflow uploads all report directories in the existing
`compatibility-test-reports` artifact. Code coverage measures executed
production code; compatibility metrics measure the bounded schedule of observations.

## Latest measured run

See [the measured results](compatibility/reports/2026-10-11/yaml.md) for main-wrapper and draft CST
observations, independent denominators, time-budget failures and production coverage.
