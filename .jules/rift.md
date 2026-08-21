## 2026-07-23 - Root-level block scalar explicit indentation calculation
**Learning:** In block scalar parsing (`parseBlockScalar`), `parentCol` is `-1` at document root. Calculating content indentation with explicit indentation indicators requires treating root-level parent columns (`effParentCol = -1`) as column 0 using `Math.max(0, effParentCol) + indentIndicator` to avoid under-calculating indentation by 1 space.
**Action:** Always check how negative column sentinels (e.g., `-1`, `ROOT_AFTER_INLINE_MARKER`) interact with relative offset calculations.
