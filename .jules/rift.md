## 2026-10-14 - Root-level block scalar explicit indentation indicator calculation
**Learning:** For root-level block scalars, `effParentCol` is `-1`. When an explicit indentation indicator (e.g. `1`) is provided, computing `effParentCol + indentIndicator` yields `-1 + 1 = 0` instead of `1`, leading to under-calculated indentation by 1 space.
**Action:** Use `Math.max(0, effParentCol) + indentIndicator` when calculating content indentation for block scalars with explicit indentation indicators.
