# lightning-yaml

## 0.2.0

### Minor Changes

- [#39](https://github.com/jbsiddall/lightning-yaml/pull/39) [`d65b86b`](https://github.com/jbsiddall/lightning-yaml/commit/d65b86b531be74f926457d0b401c5c0976718b18) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Accept a zero-indented ("compact") block sequence as an explicit mapping key (`?\n- a\n- b`). Per YAML 1.2.2 §8.2.2 (Block Mappings), an explicit key (`c-l-block-map-explicit-key`) and its value nest content through the same `s-l+block-indented(n)` production, so a same-column compact sequence is valid on the KEY side exactly as it already was on the value side; previously the deferred key resolved to null and left the `- a` line unconsumed, surfacing as a misleading "multiple documents" error on otherwise-valid input. The tab-before-a-new-collection restriction now also applies to second and later explicit keys, not just the first.

  (Why this needs fixing when the yaml-test-suite already passes: this exact deferred-key shape isn't one of the suite's scored cases — our score is unchanged at 364/373 — so it was caught by differential testing against the `yaml` oracle, which exercises spec-legal inputs the suite doesn't score.)

- [#37](https://github.com/jbsiddall/lightning-yaml/pull/37) [`9063f58`](https://github.com/jbsiddall/lightning-yaml/commit/9063f5831b66e43cddd0be4f498bd2bfd0199cac) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Reject space-then-tab sequences used as block indentation (YAML 1.2 §6.1 forbids tabs in indentation); such input was previously accepted.

  These guards cost ~4-8% of block-YAML parse time (more on deep, many-entry input), so they can be opted out per call via `parse(text, { optimizations: { skipStrictValidation: true } })` — an umbrella flag for strict-compliance validations that only reject malformed input. It trades strictness for speed/memory and accepts the tab-indented input the spec-compliant default rejects. Valid input parses identically either way: the flag can only ever turn a rejection into acceptance, never change how a well-formed document is interpreted.

## 0.1.1

### Patch Changes

- [#70](https://github.com/jbsiddall/lightning-yaml/pull/70) [`1c70048`](https://github.com/jbsiddall/lightning-yaml/commit/1c700482a00797df8afe002341479914808907b2) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Verify the automated release and npm publish pipeline end-to-end via OIDC Trusted Publishing. No functional changes to the parser or public API.
