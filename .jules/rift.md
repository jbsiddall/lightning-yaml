# Rift's Journal

## 2026-07-23 - Root-level block scalars with explicit indentation indicators
**Learning:** In `src/core.ts`, root-level parent columns are represented as `effParentCol = -1`. When an explicit indentation indicator `n` was supplied (e.g. `|2`), calculating `effParentCol + n` produced `-1 + n` (under-calculating content indentation by 1 space) instead of `Math.max(0, effParentCol) + n`.
**Action:** When calculating content indentation with explicit indentation indicators relative to parent column, always treat root-level parent columns as column 0 using `Math.max(0, effParentCol) + indentIndicator`.
