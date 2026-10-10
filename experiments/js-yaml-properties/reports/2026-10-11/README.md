# Measured experiment results — 2026-10-11

<!-- bench:6b809cddb6a18c27ea116e075c2f592b05c5616f5cea141a8800c372fad89559 js-yaml:5.2.1 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

Machine-readable counts and provenance are in [measured.json](measured.json).
This run uses Node v25.9.0 and js-yaml 5.2.1,
at experiment commit `69dd9390cb952a43b98c3423d469c03dced496e9`.
The production implementation is unchanged from `f9e62ca9b3a4df753c76537843255b77d343eb5e`.
These are observations of a bounded test schedule, not universal equivalence claims.

## Production coverage and Vitest

<!-- bench:6b809cddb6a18c27ea116e075c2f592b05c5616f5cea141a8800c372fad89559 js-yaml:5.2.1 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

All 828 tests passed across twelve files: the existing assertions and the new
property/model tests. All five production TypeScript files count in the denominator.
The compatibility CLI campaign is separate and is not included in this code coverage.

| Metric     | Covered / total    |
| ---------- | ------------------ |
| Statements | 2390/2690 (88.84%) |
| Branches   | 1985/2371 (83.71%) |
| Functions  | 179/189 (94.7%)    |
| Lines      | 2105/2279 (92.36%) |

Run `pnpm test:coverage` to reproduce the HTML Vitest report, JUnit, HTML coverage,
JSON summary and LCOV under `results/js-yaml-properties/`.
For the interactive Vitest HTML report, serve it with
`pnpm exec vite preview --outDir results/js-yaml-properties/vitest`.
The GitHub workflow uploads those directories as the
`js-yaml-properties-and-coverage` artifact. Raw generated reports are not committed.

## Sampled compatibility gaps

<!-- bench:6b809cddb6a18c27ea116e075c2f592b05c5616f5cea141a8800c372fad89559 js-yaml:5.2.1 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

The full deterministic campaign used seed 20261011: 49,393
trials, 29,101 unique descriptors and
20,292 repeated descriptors. It included
40,000 generated trials, 1,955 corpus input files and every configuration in the
4,096-case finite boolean/quote-style basis. Corpus variants include duplicate
YAML texts; neither trial count nor descriptor count is a count of distinct YAML strings.

| Bucket                                 | Observed discrepancy                                              | Denominator                       |
| -------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| Generated YAML, default options        | 0 value/type/reference-graph gaps                                 | 16,438 inputs accepted by js-yaml |
| Generated YAML rejected by js-yaml     | 521 accepted by lightning-yaml                                    | 3,562 js-yaml rejections          |
| Generated value graphs, default dump   | 0 decoded semantic gaps; 4,190 byte differences                   | 20,000 successful dumps           |
| Corpus load/loadAll                    | 110 semantic gaps (4.34%): 18 call failures + 92 graph mismatches | 2,533 js-yaml successes           |
| Corpus load/loadAll rejection behavior | 385 accepted by lightning-yaml                                    | 1,377 js-yaml rejections          |
| Corpus-derived dump                    | 0 decoded semantic gaps; 551 byte differences (45.28%)            | 1,217 successful dumps            |
| Finite boolean/quote-style dump matrix | 4,096 lightning-yaml call failures                                | 4,096 js-yaml successes           |

The complete matrix currently fails at the compatibility shim because it rejects
explicit `quoteStyle` and `skipInvalid` options (even `skipInvalid: false`).
The matrix therefore measures option acceptance; it does not exercise the parser's
formatting paths for those rejected calls. Its zero unequal byte strings means
no candidate strings were produced, rather than byte agreement.

Across the whole schedule, 14,007/49,393 trials have some discrepancy (28.36%).
This number is sensitive to the schedule and includes formatting, errors and
callbacks. It is **not** an estimate of the percentage of all js-yaml behavior
that lightning-yaml lacks. Most cases where both libraries throw also have different
error details; those are separate from value and rejection discrepancies.

Every declared load/dump option has a witness. Unbounded numeric/string inputs,
custom sequence/mapping tags and arbitrary callbacks remain unenumerated. Random
containers are bounded to depth two; typed values, cycles and alias topology have
fixed sentinels. Cyclic `noRefs` combinations are not scheduled. The audit saves
replayable cases without shrinking them.

All gaps reported here belong to the unchanged baseline implementation. This
experiment adds measurements and tests; it does not repair compatibility behavior.
