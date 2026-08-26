## 2026-08-26 - Root block scalar explicit indentation indicator calculation
**Learning:** In `src/core.ts`, root-level block scalar parent column is normalized to `-1`. When calculating `contentIndent` with an explicit indentation indicator (e.g., `|2`), adding `indentIndicator` directly to `effParentCol` resulted in `contentIndent = 1` instead of `2`.
**Action:** Always clamp `effParentCol` to minimum 0 (`Math.max(0, effParentCol)`) when calculating explicit block scalar indentation.
