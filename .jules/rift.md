## 2026-03-30 - Root-level block scalar explicit indentation indicator
**Learning:** Root-level block scalars (where `effParentCol = -1`) with an explicit indentation indicator (e.g. `|1`, `|2`) were under-calculating `contentIndent` by 1 space because `effParentCol + indentIndicator` evaluated to `-1 + 1 = 0` (or `-1 + 2 = 1`).
**Action:** Always clamp `effParentCol` to at least 0 (`Math.max(0, effParentCol) + indentIndicator`) when calculating explicit block scalar indentation.
