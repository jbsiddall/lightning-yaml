# Measured yaml compatibility

These are bounded observations, rather than a percentage of all package behavior.
Reference: yaml 2.9.0; runtime: v25.9.0. Production source comes from
`f9e62ca9b3a4df753c76537843255b77d343eb5e`. The source-aware candidate is the unmerged
[PR #184](https://github.com/jbsiddall/lightning-yaml/pull/184), pinned at
`6a25ef63d6d9d5114515660ecc25a06542af6647`. The workflow uploads raw reports and replay inputs for its own audit run.
Use the full audit commands in the guide to reproduce this larger local schedule.

## Main's partial wrapper

Harness: `dee7bafe7be8f54147da53580546fbeb29f17234`; 49156 trials,
33312 unique descriptors, including 1955 corpus input files.
Descriptor counts include repeated YAML text; options and operations distinguish cases.

| Observation                                                                | Disagreements / eligible trials |
| -------------------------------------------------------------------------- | ------------------------------: |
| Parse values or candidate failures, reference-successful parse calls       |                        566/7617 |
| Stringify decoded values or candidate failures, reference-decodable output |                      1240/22646 |
| Stringify bytes, both calls returned strings                               |                      9607/21468 |
| Document AST, both document calls succeeded                                |                     17248/17305 |
| Document conversions including repeated calls and mutations                |                     14949/17305 |

<!-- bench:05e39fdddfe53126e89685ebaafb12f73c857feb89fb044f9aed95ded355bed9 yaml:2.9.0 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

Full option/operation/family denominators: [measured-main.json](measured-main.json).
The wrapper does not expose the Parser/Composer/CST API required by the source-aware goal.

## Draft CST/document/node pipeline

Harness: `52f132bb10be8de9e9e906a19aa62c7de583e45f`; 20000 generated inputs plus
1955 corpus files, 21955 comparisons scheduled.
21900 completed pipelines all showed at least one discrepancy;
55 comparisons exceeded the 2000 ms worker budget.
The budget includes both implementations and worker startup, so a timeout does not
identify which implementation was slow or prove nontermination. Unknown results
remain outside comparable layer denominators.

| Layer                   | Different / comparable | Unavailable |
| ----------------------- | ---------------------: | ----------: |
| acceptance              |                0/21900 |          55 |
| tokens                  |            21788/21900 |          55 |
| token-identity          |            12110/21900 |          55 |
| documents               |            21060/21900 |          55 |
| nodes                   |            21881/21900 |          55 |
| node-identity           |             1729/21900 |          55 |
| source-token-identity   |            21705/21900 |          55 |
| diagnostics             |             2968/21900 |          55 |
| values                  |             2537/21900 |          55 |
| lineCounter             |             1933/21900 |          55 |
| reconstructed           |              318/21900 |          55 |
| reconstruction-equality |              318/21900 |          55 |

<!-- bench:f083c464ef15c061f524aca002845ca01807911bc1b4abd62ccd8c8dc6e9b98d yaml:2.9.0 ly:6a25ef63d6d9d5114515660ecc25a06542af6647 -->

Some differences repeat across cases, including scalar token indentation and
missing default node/directive fields. These counts are not distinct bugs.
Strict source-field differences remain observable even when converted values match.
[measured-cst.json](measured-cst.json) records the pin, limits and timed-out input IDs.
The audit does not establish language-server integration or all-input equivalence.

## Vitest and production coverage

859 tests passed across 16 files. All 5 production source files are in the denominator.

| Metric     | Coverage |
| ---------- | -------: |
| Lines      |   92.93% |
| Branches   |   84.09% |
| Functions  |   95.23% |
| Statements |   89.44% |

<!-- bench:f83ecd8b71b0e2a0a318a33568ab6ee6781ba645972e26d84718bb2b799d8966 yaml:2.9.0 ly:f9e62ca9b3a4df753c76537843255b77d343eb5e -->

HTML Vitest, JUnit, HTML coverage, JSON summary and LCOV are uploaded by the
YAML compatibility workflow as `js-yaml-properties-and-coverage`.
Coverage measures production code execution; the source-aware draft is excluded.
See [the experiment guide](README.md) for setup, replay and known exclusions.
