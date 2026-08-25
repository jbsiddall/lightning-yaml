## 2026-08-25 - Root-level explicit block scalar indentation calculation
**Learning:** For root-level block scalars (`parentCol = -1`), explicit indentation indicators (`|2`) must be added to column 0 (`Math.max(0, parentCol)`), not `-1`. Otherwise, content indentation is calculated as `indentIndicator - 1`, stripping 1 fewer space than specified.
**Action:** When working with explicit indentation indicators on block scalars, ensure root-level parent columns are clamped to `0`.
