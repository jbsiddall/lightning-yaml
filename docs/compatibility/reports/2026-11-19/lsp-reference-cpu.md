# Incomplete reference LSP CPU diagnostic

The single authorized attempt ended with exit 1. Compose repeat 1 completed all 1,000 parses, but exact owned operation-leaf coverage was **452/571 = 79.1593695%**, below the frozen 80% screen. The useful-sample screen passed (452 against a minimum of 200). The campaign stopped at this first inadequacy. Five scheduled entries remain pending. There was no retry or replacement capture. This is an inconclusive reference diagnostic, with no optimization, eligibility, universal CPU ceiling, or representative workload result.

The [safe scalar export](lsp-reference-cpu-observations.json) preserves the ordered ledger, original attribution rows, clocks, policy, measured identity and private artifact digests. Its SHA256 is `721958591c9294f130544458566d68adc07818f32f53e5866d2f00b3cd4ece9c`. Raw profiles, original runtime resolver strings and absolute local paths remain private. The frozen [protocol](../2026-11-18/lsp-cpu-next-experiment.md) and [collector documentation](../../lsp-reference-cpu.md) describe the reviewed experiment. The earlier [historical CPU audit](../2026-11-18/lsp-cpu-profiles.md) remains a separate observation.

## Attempt and ordered ledger

| Order | Fixture | Repeat | Campaign state | Completed parses | Cleanup |
| --- | --- | ---: | --- | ---: | --- |
| 1 | Compose | 1 | incomplete: sampling screens inadequate | 1,000 | private artifact retained |
| 2 | ZooKeeper | 1 | pending | 0 | not started |
| 3 | CMake | 1 | pending | 0 | not started |
| 4 | CMake | 2 | pending | 0 | not started |
| 5 | ZooKeeper | 2 | pending | 0 | not started |
| 6 | Compose | 2 | pending | 0 | not started |

The first child's collection receipt says `completed`, with one document, no operation error and no collection failure. The campaign says `incomplete` because its adequacy screen failed. The attempt ended with no timeout, signal or external guard termination recorded. Complete external process elapsed time was 1,766.974794 ms. Campaign elapsed time was 1,737.876466 ms and shared inner elapsed time was 1,538.182891 ms. The export retains the wrapper's cautious cleanup receipt separately from the child's retained-artifact receipt. Pending rows represent unobserved cases.

The fixed policy used three discarded warmups, 1,000 measured operations and a requested 1,000 µs sampling interval for each scheduled child. The outer 60,000 ms budget starts at the campaign process's `performance.now` origin, including setup. The shared 49,000 ms inner budget starts with the first child launch and never resets. A separate 65,000 ms process guard bounds the attempt. All remaining scheduled work was suppressed after the first inadequacy.

## Identity and operation

Measured harness head was `1bfa775d0f0bcda3596001c03a83862391d7a9d0`, tree `f8d72b6d9894a4722e5310a42f49e4e8767d1fc6`, clean at capture. Server head was `4bf9c818850bf9751696d24848fdeaececb4203c`, tree `cbd49da58734d081dd1b855e7adafa4aa18131fc`. Runtime was Node v24.19.0 / V8 13.6.233.17-node.51, x64, with no extra Node options. Publication changes follow the measured head and preserve the measured scripts.

The stock `yaml@2.9.0` physical closure contains 72 files, digest `2dd772e1e6839d90159c0fa900247b2d9854766c4d17f8953eb704110c03b217`. The compiled server relative-import closure contains 23 files, digest `d80b96a9ee4e9c769e9c0398d0985ece1d4151a6b982f7e4005eef4244df7149`. These closure digests include physical absolute paths as well as content. Relocation therefore changes these digests even when the file contents match. External dependency entries, interpretation scopes and the adapter's separate CommonJS TextDocument entry were pinned too. Independent postcapture verification matched all 156 envelope pins. The export records runtime, input, external file and exact ownership module hashes, plus plan, manifest, envelope, seal and receipt digests.

The actual server parse used `uniqueKeys: true`, YAML 1.2, `strict: false`, and `keepSourceTokens: true`. Verified effective custom tags were `!count` scalar→number, `!record` mapping→object, and the server's implicit `!include` scalar. Caller TextDocument was absent. The loop retained one latest result holder and ordinary server caches. TextDocument caller and editor lifecycle costs remain unmeasured. The five runtime resolver parent/target strings are redacted, and the last graph was not retained. Independent postcapture replay is limited to the retained redacted evidence for those checks. The pinned reviewed validator required both checks and the receipt reports successful acceptance, with no graph, policy or identity failure recorded.

## Separate clock scopes

The bracketed loop wall clock was 634.059976 ms. Process CPU deltas were 930,386 µs user and 53,674 µs system (984.060 ms combined). These deltas include all process threads and have a different scope from sampled-isolate CPU. Snapshot order was wall start, CPU start, batch, CPU end, wall end. Wall time includes scheduling and sampling overhead. Inspector's independent span was 659,736 µs. No shared epoch or per-operation timestamps are asserted.

Inspector deltas sum to 659,399 µs: the first framing observation contributes 25,125 µs, subsequent observations 634,274 µs, with a trailing unassigned residual of 337 µs. Observed intervals range from 523 to 25,125 µs. The first observation is Inspector `post`/request framing, kept separate from the operation screen. Interval-weighted estimates below describe observed intervals, with sampling uncertainty and no exact per-function timing.

## Original attribution and ancestry caveat

There were 572 observations: one framing observation and 571 post-framing observations. Exact operation ancestry appears on 454. Of these, 452 have an exact owned operation leaf and confer coverage. The other two operation observations are one unknown adapter `operation` frame (`bench-lsp.mjs`, raw V8 definition 607:18) and one operation boundary. All raw definition locations in the export are zero based. Exact source ownership checks function name, module, line and column against hashed source. An unknown leaf stays unknown regardless of wrapper ancestry.

| Original exclusive category | Samples | Interval estimate (µs) |
| --- | ---: | ---: |
| framing | 1 | 25,125 |
| lexerParser | 284 | 317,063 |
| serverTagSetup | 10 | 10,957 |
| composition | 67 | 76,478 |
| serverWrapper | 11 | 11,955 |
| referenceSetup | 9 | 9,820 |
| referenceHelpers | 24 | 26,271 |
| serverAstConversion | 18 | 19,676 |
| runtime | 31 | 33,796 |
| scalarDecoding | 29 | 31,633 |
| harness | 86 | 94,425 |
| unknown | 1 | 1,082 |
| boundary | 1 | 1,118 |

The original `harness` label marks observations that lack the exact operation ancestry. Its 86 observations include ancestry-ambiguous parser/server work, so their cost remains unresolved. Independent raw-tree decoding separates its 86 observations into 83 known parser/server leaves under batch→server parse with `runProfiledOperation` absent (91,730 µs), one lexer `parseNext` leaf directly under the profile root (1,083 µs), and two batch-only leaves (1,612 µs). The parser/server work remains recognizable by exact source identity, while its required operation ancestry is missing. These observations remain excluded from frozen coverage.

Inclusive server-wrapper membership is 535 observations: 452 intersect operation ancestry and 83 do not. Operation membership is 454: those 452 plus the unknown adapter and boundary observations. The profile also contains a server parse directly beneath the operation wrapper with the intervening adapter frame absent. These are observable stack omissions. The profile contains no explicit JIT tier or inlining events and no `deoptReason` records. Their mechanism is unproved. Attributing the omissions to JIT optimization would exceed the evidence.

The 31 runtime observations are detached garbage-collector leaves and remain in the coverage denominator. The export preserves all exclusive, operation-exclusive, nearest-owned and inclusive rows separately, including the independently decoded fallback leaf categories and caller witnesses. Inclusive rows overlap. Coverage remains restricted to exact owned operation leaves, with nearest-owned ancestry reported separately. Absent categories have no observations under that assignment. General custom-callback cost remains unmeasured with this tag-free input. Composition/scalar decoding and tag setup are distinct from actual custom-tag callbacks.

The frozen result remains inadequate. Before proposing another independently authorized experiment, an inert boundary-observability test could examine whether the required stack boundary can be reliably observed. No such new capture or experiment is part of this report. There is no repeat agreement or cross-shape concentration result, and no candidate comparison, memory, or lifecycle evidence. P1 compatibility, memory and lifecycle gates remain open. P2 and the project's 10–100× goal are unchanged.

<!-- yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:1bfa775d0f0bcda3596001c03a83862391d7a9d0 data:721958591c9294f130544458566d68adc07818f32f53e5866d2f00b3cd4ece9c -->
