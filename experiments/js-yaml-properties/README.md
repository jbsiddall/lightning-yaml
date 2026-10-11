# js-yaml differential testing experiment

This branch adds tests around the implementation inherited from `origin/main`.
The parser and compatibility shim are unchanged. The reference is pinned to
js-yaml **5.2.1**, whose API differs from v4.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --dir experiments/js-yaml-properties install --frozen-lockfile --strict-peer-dependencies
pnpm gen:suite
pnpm test:properties
pnpm test:coverage
pnpm audit:js-yaml:full
```

The property package isolates zod3/fast-check3, required by zod-fast-check,
from the root's zod4. `@fast-check/vitest` runs generated property tests;
`ZodFastCheck().inputOf()` supplies scalar arbitraries used in the campaign.

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

## Interpret the reports

Each audit directory under `results/js-yaml-properties/` contains:

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

- HTML Vitest: `results/js-yaml-properties/vitest/index.html`
- JUnit: `results/js-yaml-properties/vitest/junit.xml`
- HTML coverage: `results/js-yaml-properties/coverage/index.html`
- JSON summary / LCOV: the same coverage directory.

Serve the interactive Vitest report using:

```sh
pnpm exec vite preview --outDir results/js-yaml-properties/vitest
```

The workflow uploads all reports as `js-yaml-properties-and-coverage`, including
reports produced before a failing step. Line/branch coverage measures executed
production code. The compatibility audit measures sampled observable behavior.
They are independent measurements.

## Recorded run

[Measured results for 2026-10-11](reports/2026-10-11/README.md) include the initial
coverage percentages and the separate corpus, generated-input and option-matrix gaps.

## yaml compatibility campaign

The same isolated package also runs the [yaml campaign](yaml/README.md), with a
separate reference and report directory. `pnpm test:properties` and
`pnpm test:coverage` include both sets of harness tests. The CI artifact includes
all audit directories, including the pinned draft CST pipeline. See the yaml guide
for the distinction between the implementation on `main` and the unmerged CST work.

Node Buffers are compared and transported by their visible bytes, exact Buffer
brand and object identity. Their ambient pooled backing storage and offsets are
excluded; other built-in typed arrays retain backing-buffer identity checks.
