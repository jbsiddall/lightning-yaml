---
"lightning-yaml": minor
---

Reject space-then-tab sequences used as block indentation (YAML 1.2 §6.1 forbids tabs in indentation); such input was previously accepted.

These guards cost ~4-8% of block-YAML parse time (more on deep, many-entry input), so they can be opted out per call via `parse(text, { optimizations: { skipTabIndentChecks: true } })` — a speed-for-strictness trade that accepts the tab-indented input the spec-compliant default rejects. Valid input parses identically either way (the guards only ever throw, never transform).
