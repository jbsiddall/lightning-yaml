---
"lightning-yaml": patch
---

Fix content indentation calculation for root-level block scalars with explicit indentation indicators (e.g. `|1`, `|2`, `>1`, `>2`). Previously, at the root document level where parent column is `-1`, calculating `effParentCol + indentIndicator` under-calculated content indentation by 1 space, leaving an unstripped leading space on content lines. Using `Math.max(0, effParentCol) + indentIndicator` correctly calculates content indentation relative to column 0 at the root level, per YAML 1.2.2 §8.1.1.1.
