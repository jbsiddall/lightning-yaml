---
"lightning-yaml": patch
---

Fix content indentation calculation for root-level block scalars with an explicit indentation indicator (e.g. `|2` or `>1`). At the root level of a document, parent column is 0 (represented internally as `-1`), so adding an explicit indentation indicator `n` resulted in `-1 + n` (off by 1 space). Root-level explicit indentation indicators now correctly calculate content indentation as `0 + n` spaces per YAML 1.2.2 §8.1.1.1.
