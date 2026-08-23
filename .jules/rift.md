## 2026-07-23 - Root-level block scalar explicit indentation calculation
**Learning:** When calculating indentation for block scalars with explicit indentation indicators (`|2`, `>1`), root-level parent columns are represented as `effParentCol = -1`. Directly adding the indicator (`-1 + 2 = 1`) under-calculates the content indentation by 1 space at document root.
**Action:** Always clamp `effParentCol` to non-negative column index using `Math.max(0, effParentCol) + indentIndicator`.
