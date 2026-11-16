# YAML language-server parser feasibility evidence (2026-11-16)

## Result

The bounded matched-policy library runs completed two paired repeats for three original YAML streams and a separate 30-document derived GitHub Actions stream. CPU and retained-heap factors were near 1×; no completed cell showed a 10× gain in both. The 312-document derived stream is incomplete and has no two-repeat summary. The actual server still uses provider-specific literal defaults that differ, so actual-server diagnostics do not establish a matched-policy performance result. P0 remains incomplete and P1 is unready; the 10–100× target remains open.

Factors below are **reference ÷ candidate**, so values above 1 favor the candidate. Each complete cell reports the median and range of two paired ratios. These are descriptive two-sample summaries, not confidence intervals. CPU and wall values are per complete stream operation. Primary memory is the post-GC retained-heap delta divided by 25 returned streams. Peak RSS is the absolute isolated-process high-water mark and is a separate measure.

| Explicit `uniqueKeys: false` stream | CPU factor | Wall factor | Retained-heap factor | Absolute peak RSS factor |
| --- | ---: | ---: | ---: | ---: |
| Compose, 1,608 B / 1 document | 0.9907 [0.9262, 1.0552] | 1.0228 [0.8777, 1.1679] | 0.9806 [0.9675, 0.9938] | 1.1311 [1.1302, 1.1321] |
| ZooKeeper, 2,903 B / 4 documents | 0.9885 [0.9798, 0.9972] | 1.0065 [0.9745, 1.0386] | 0.9737 [0.9509, 0.9965] | 1.1126 [1.1066, 1.1186] |
| GitHub Actions original, 3,356 B / 1 document | 1.0024 [0.8673, 1.1374] | 0.8849 [0.7929, 0.9769] | 1.0027 [0.9966, 1.0089] | 1.1326 [1.1312, 1.1341] |
| GitHub Actions derived, 100,825 B / 30 documents | 1.0049 [0.9441, 1.0658] | 1.0132 [0.9249, 1.1015] | 0.99769 [0.99763, 0.99775] | 0.99249 [0.99108, 0.99389] |
| GitHub Actions derived, 1,048,627 B / 312 documents, repeat 1 only | 0.99353 | 1.02784 | 0.99779 | 1.11909 |

The last row is one completed repeat, not a median. In repeat 2, the reference CPU/wall operation completed; the candidate CPU/wall worker timed out (`ETIMEDOUT`), and both retained-heap and peak-RSS pairs remained pending. The run ended with 7 completed phases, 1 failed phase, and 4 pending phases. This bounded timeout is not evidence of nontermination or of the candidate's eventual CPU time. The 30- and 312-document streams repeat the original complete GitHub Actions CMake documents; they are scale inputs, not independent upstream fixtures.

No original stream approaches the 10× target. Peak RSS is not a substitute for retained heap, and one favorable scale cell cannot be selected as a representative result. Bare matched-policy outcomes do not imply an actual-consumer speedup or a joint CPU-and-memory gain.
<!-- yaml:2.9.0 ly:8ea0498b65b80806dfd67d1815b4faefcdede04e data:883aaeb39b9196e3345146e82534951278e1b67d9a24179bd29ad13cebdcc19c -->

## Run integrity and scope

The measurement harness was commit `eb4b3adcd5f3cf9a97a6f8430c468f84b652347c` (tree `fa7746d05118009327197747d54d087b38572c92`). The candidate was `8ea0498b65b80806dfd67d1815b4faefcdede04e`; the unchanged language server was `4bf9c818850bf9751696d24848fdeaececb4203c`. Reference `yaml` was 2.9.0, candidate `lightning-yaml` was 0.1.1, and the server-declared dependency was yaml 2.8.3. The candidate and reference provider semantic preflights agreed for every selected cell, and all recorded paired phase output digests matched.

Protocol used two paired repeats, three warmups and 25 timed operations for CPU/wall and retained heap, and one operation in a fresh process for peak RSS. Workers ran serially with provider order alternated in repeat two. The outer campaign limit was 60 seconds from CLI entry, including provider loading, fixture preparation and semantic preflight; the scored phase budget was capped at 49 seconds and the remaining outer time. The original cells used the three pinned corpus files; the separate scale inputs had 30 and 312 documents.

The first real `--measure` invocation, on harness `8821cfc7`, exited 1 during report finalization with a `preflightComplete` scope error and emitted no usable measurement JSON. Whether any worker executed is unknown. It is preserved as unscored execution-unknown evidence and tracked in [issue #326](https://github.com/jbsiddall/lightning-yaml/issues/326). In the same launch sequence, the attempted final prelaunch-manifest write failed because its expected review-receipt path was absent; orchestration proceeded despite that failed command, so no final manifest was created for the first attempt. The selected dry-run plans and protocol predeclarations had been saved earlier. The separately reviewed recovery used harness `eb4b3adc`; its own reviewed prelaunch manifest was checked before that recovery. This later result does not replace or backdate the failed attempt. The recovery, scale-30 run and scale-312 run source JSON SHA-256 values are respectively `7e66660a00183d6885781c70c7d53134f73207d4e39cabf249ffcb6bf4815b55`, `f352bb25a030c724f8417c38730b3742e377327dcaafd59ff4ef83125edba280`, and `aceb7a1f522cf6bc3b336a635cf192c17543d34e4743cd76f7f153f675275081`.

The [compact observations export](lsp-observations.json) preserves every actual phase row and schedule/eligibility ledger, including failed, pending, and unselected IDs. It omits repeated decoded YAML/AST output trees, raw fixture text, and full dependency-closure path lists. It retains original raw file sizes and digests, phase numbers, semantic/output digests, closure file counts/byte totals/digests, and diagnostic artifact sizes/digests. Raw CPU profiles and heap snapshots are not published. Export SHA-256: `883aaeb39b9196e3345146e82534951278e1b67d9a24179bd29ad13cebdcc19c`.

## Non-scored diagnostics

The separate diagnostic ledger completed all 12 declared cases in 6.09 seconds (four CPU profiles, six graph censuses and two heap snapshots); `scored` is false. Diagnostics used actual-server literal defaults where applicable. The server does not override `uniqueKeys`: stock `yaml` defaults to true and the candidate defaults to false. These actual-server rows therefore remain ineligible for matched-policy performance comparisons.

The four original GitHub Actions CPU profiles passed the declared sampling-coverage guard (at least 200 useful samples and at least 80% classified coverage):

| Profile | Total / useful / unassigned samples | Classified coverage |
| --- | ---: | ---: |
| Bare candidate | 233 / 210 / 3 | 98.71% |
| Bare reference | 273 / 243 / 7 | 97.44% |
| Server candidate | 225 / 211 / 1 | 99.56% |
| Server reference | 268 / 238 / 1 | 99.63% |

These are sample counts, not time-weighted CPU shares or all-thread process CPU attribution. The classifier's `customCallbacks` label also includes ordinary built-in `resolve*` frames, so it does not identify user-callback time. Genuine server AST converter frames were 11/225 and 9/268 samples; server wrapper frames are separate. Profile sampling does not prove that any category is the optimization bottleneck.

The six graph censuses are partial own-property walks of the current literal-default server outputs. Candidate/reference non-array object counts were Compose 555/553, ZooKeeper 1,491/1,486, and GitHub Actions 766/764; array counts were equal at 258, 750 and 356. The census excludes schema contents, prototypes and module roots, and the alias cache may retain the latest AST. Selected string-field occurrences and code units are not unique physical strings or bytes. The two GHA heap snapshots kept the operation result live, but emitted no identity-to-heap-node mapping; snapshot file sizes are serialization sizes, not retained heap. Therefore a mandatory-output byte floor is unknown.

These diagnostics describe limited current work and output shapes. They do not establish exact CPU attribution, a full retained graph, a mandatory-byte floor, or a same-behavior actual-server performance gain. Caller `TextDocument` state and post-drop cache lifetime were not measured.
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c data:883aaeb39b9196e3345146e82534951278e1b67d9a24179bd29ad13cebdcc19c -->

## Decision

This evidence does not satisfy the same-behavior actual-consumer goal of a joint 10× CPU and 10× retained-memory improvement. Matched-policy bare-library results are near parity; actual-server defaults differ; the byte floor, representative server attribution, editor/cache lifetime behavior and complete large-stream comparison remain unresolved. Keep the 10–100× ambition unchanged. Resolve and test the actual-consumer policy contract before opening further performance work; do not treat policy changes or parity as success.
