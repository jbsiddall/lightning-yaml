---
"lightning-yaml": minor
---

Reject space-then-tab sequences used as block indentation (YAML 1.2 §6.1 forbids tabs in indentation); such input was previously accepted.

These guards cost ~4-8% of block-YAML parse time (more on deep, many-entry input), so they can be opted out per call via `parse(text, { optimizations: { skipStrictValidation: true } })` — an umbrella flag for strict-compliance validations that only reject malformed input. It trades strictness for speed/memory and accepts the tab-indented input the spec-compliant default rejects. Valid input parses identically either way: the flag can only ever turn a rejection into acceptance, never change how a well-formed document is interpreted.
