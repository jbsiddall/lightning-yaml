# YAML language-server parser feasibility: explicit-true baseline (2026-11-17)

## Result

The two predeclared bare-provider campaigns completed: all three original YAML streams with the explicit `uniqueKeys: true` policy, and a separate 30-document derived GitHub Actions stream under the same explicit policy. CPU and retained-heap factors stayed around 1×. The original-stream CPU medians ranged from 0.9287 to 1.1322, while retained-heap medians ranged from 0.9947 to 0.9998. These four cells provide no evidence for the unchanged joint 10× CPU and 10× retained-memory target. The 30-document stream is a scale copy of one original fixture, not additional upstream corpus breadth.

Factors are **reference ÷ candidate**, so values above 1 favor the candidate. Each cell shows the arithmetic median and range of exactly two paired ratios. These are descriptive two-repeat summaries, not confidence intervals. CPU and wall are per complete input stream operation. Retained heap is the post-GC delta for 25 retained complete results; the factor is unchanged if both sides are divided by 25, and no per-operation byte values are inferred here. Absolute peak RSS is a separate process high-water mark, not the retained-heap measure.

| Explicit `uniqueKeys: true` stream | CPU factor | Wall factor | Retained-heap factor | Absolute peak RSS factor |
| --- | ---: | ---: | ---: | ---: |
| Compose, 1,608 B / 1 document | 0.9287 [0.8371, 1.0203] | 0.8309 [0.7067, 0.9551] | 0.9998 [0.9876, 1.0119] | 1.1349 [1.1347, 1.1350] |
| ZooKeeper, 2,903 B / 4 documents | 1.0746 [0.9981, 1.1511] | 1.1727 [1.0636, 1.2818] | 0.9947 [0.9929, 0.9964] | 1.1117 [1.1035, 1.1198] |
| GitHub Actions original, 3,356 B / 1 document | 1.1322 [1.1319, 1.1325] | 1.1444 [1.0934, 1.1954] | 0.9965 [0.9962, 0.9968] | 1.1364 [1.1307, 1.1420] |
| GitHub Actions derived, 100,825 B / 30 documents | 1.0347 [0.9954, 1.0741] | 1.0375 [0.9980, 1.0769] | 0.9977 [0.9976, 0.9979] | 0.9904 [0.9829, 0.9979] |

<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:b849a0053a98f079fd5f3771b38648a4c4f72f41 data:a49da30569b75b2287f8b9a0567fbf10d6468af7aa9c14305afecd98a6aa1e0c -->

No cell approaches a 10× gain in both primary measures. The two-repeat ranges also show why this table should not be read as a stable ranking: Compose CPU/wall favor the reference, while the original GitHub Actions stream favors the candidate on CPU/wall; retained-heap ratios remain close to parity. Peak RSS varies separately and does not replace the primary retained measure. Do not generalize the short paired results into an optimization prescription.
<!-- yaml:2.9.0 ly:b849a0053a98f079fd5f3771b38648a4c4f72f41 data:a49da30569b75b2287f8b9a0567fbf10d6468af7aa9c14305afecd98a6aa1e0c -->

## Campaigns and integrity

The originals campaign selected the three original fixture cells with the explicit `uniqueKeys: true` override and no `TextDocument` (`absent` in each cell ID), scheduled 36 phase observations, and completed all 36. Its three explicit-false alternatives remained `notSelected`. The separate scale campaign selected the 30-document true-policy cell, scheduled and completed 12 observations; its false-policy 30-document and both 312-document policy cells remained `notSelected`. All 24 candidate/reference phase pairs have matching output digests. Each campaign used two paired repeats, three warmups and 25 operations for CPU/wall and retained heap, and one operation in a fresh process for peak RSS. The semantic preflight passed for every selected cell, and candidate/server artifact hashes were unchanged before and after the campaigns.

The measured harness was `b849a0053a98f079fd5f3771b38648a4c4f72f41` (tree `2bb25593e55f78ed63adb1ac0982bafc27994d22`). The candidate was `8ea0498b65b80806dfd67d1815b4faefcdede04e`; the unchanged server was `4bf9c818850bf9751696d24848fdeaececb4203c`, with declared `yaml` dependency version 2.8.3. The reference was `yaml` 2.9.0. The candidate entry and 3-file closure, server compiled entry and 23-file closure, reference entry and 72-file closure, installed server alias, and hashes for the measured harness scripts are recorded in the compact export. Closure file lists are omitted, while counts, byte totals, and closure hashes remain.

The separately approved prelaunch manifest was validated before the two campaign launches. The CLI retained its 60-second outer and 49-second inner work budgets; an external 70-second process guard allowed startup and report finalization. Complete process wall time was 8,764.687039 ms for originals and 12,387.997580000001 ms for scale-30. The report's internal `elapsedMs` values were 8,139.266671 ms and 11,293.736376 ms respectively; these are distinct clocks and are not presented as full process time. Plans, semantic check, manifest, launch intent, execution receipts, exact raw report sizes/hashes, and all 48 observations are available in the export.

The export omits repeated decoded output trees, fixture text, and full dependency-closure path lists. It retains observation identities, schedules, all scalar metric fields, input/output digests, source byte counts and fixture hashes, semantic comparisons and preflight digests, selected/not-selected and completed/failed/pending ledgers, provider provenance, and per-run execution receipts. P0d added no diagnostics, profiles, or snapshots.
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:b849a0053a98f079fd5f3771b38648a4c4f72f41 data:a49da30569b75b2287f8b9a0567fbf10d6468af7aa9c14305afecd98a6aa1e0c -->

## Interpretation and limits

This is a matched-policy bare-library baseline. It does not make the unchanged language server eligible: that server uses literal provider defaults, whose duplicate-key diagnostics differ, and it does not forward a `uniqueKeys` override. The matching explicit-true Composer controls do not establish actual-server equivalence, server-AST retention, or an actual-consumer performance gain. The baseline is also separate from the earlier explicit-false campaign; comparisons across those distinct campaigns are not causal evidence about the option.

The earlier first `--measure` launch on harness `8821cfc7` remains execution-unknown and unscored. The earlier false-policy 312-document attempt remains 7 completed, 1 failed, and 4 pending; the true-policy 312-document cell was not run. Those histories are preserved in the [2026-11-16 report](../2026-11-16/lsp.md), and this completed campaign does not replace them. The lifecycle scenarios involving caller-provided `TextDocument` state and post-drop cache behavior also remain unmeasured; they were not among the completed diagnostic ledger's 12 declared cases.

The true-policy baseline does not close P0. Actual-consumer compatibility, representative server attribution, a verified full CST/provider-AST/server-AST mandatory-byte floor, lifecycle behavior, and the 312-document true-policy cell remain open. The mandatory-output byte floor is still unknown. P1 remains unready; the joint 10–100× CPU and primary retained-memory ambition is unchanged.
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:b849a0053a98f079fd5f3771b38648a4c4f72f41 data:a49da30569b75b2287f8b9a0567fbf10d6468af7aa9c14305afecd98a6aa1e0c -->
