## 2026-10-29 - Root-level block scalar explicit indentation calculation

**Learning:** In `src/core.ts`, root-level parent columns are represented as `effParentCol = -1`. When an explicit indentation indicator `indentIndicator` (1-9) is present on a block scalar at root level, adding `indentIndicator` directly to `-1` yields `-1 + indentIndicator` (off-by-one under-calculation of content indentation) instead of `0 + indentIndicator`. Clamping `effParentCol` with `Math.max(0, effParentCol)` before adding `indentIndicator` correctly measures indentation relative to column 0.
**Action:** When calculating relative indentation offsets from `parentCol` or `effParentCol`, always clamp `effParentCol` to `0` with `Math.max(0, effParentCol)` to handle the root document sentinel (`-1`).
