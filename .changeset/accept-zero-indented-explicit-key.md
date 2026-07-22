---
"lightning-yaml": minor
---

Accept a zero-indented ("compact") block sequence as an explicit mapping key (`?\n- a\n- b`). Per YAML 1.2.2 §8.2.2 (Block Mappings), an explicit key (`c-l-block-map-explicit-key`) and its value nest content through the same `s-l+block-indented(n)` production, so a same-column compact sequence is valid on the KEY side exactly as it already was on the value side; previously the deferred key resolved to null and left the `- a` line unconsumed, surfacing as a misleading "multiple documents" error on otherwise-valid input. The tab-before-a-new-collection restriction now also applies to second and later explicit keys, not just the first.

(Why this needs fixing when the yaml-test-suite already passes: this exact deferred-key shape isn't one of the suite's scored cases — our score is unchanged at 364/373 — so it was caught by differential testing against the `yaml` oracle, which exercises spec-legal inputs the suite doesn't score.)
