## 2026-08-18 - Root-level block scalar explicit indentation indicator
**Learning:** Root-level block scalars (`parentCol = -1`) with an explicit indentation indicator `m` (e.g. `|1`, `|2`, `|+1`, `|-1`) under-calculated content indentation by 1 space because `effParentCol + indentIndicator` computed `-1 + m` instead of `0 + m`.
**Action:** Always clamp `effParentCol` to `Math.max(0, effParentCol)` when computing content indentation from explicit indentation indicators.
