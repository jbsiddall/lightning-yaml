## 2026-08-10 - Root-level block scalar explicit indentation indicator calculation

**Learning:** When calculating block scalar content indentation with explicit indentation indicators (`|n` or `>n`), `effParentCol` for document-root level nodes is `-1`. Calculating `effParentCol + indentIndicator` at root level results in `-1 + n`, which under-calculates the required content indentation by 1 space.
**Action:** Always floor `effParentCol` at `0` using `Math.max(0, effParentCol) + indentIndicator` so document-root level parent indentation is treated as column 0.
