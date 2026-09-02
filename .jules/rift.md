# Rift's Journal 🌀

## 2026-07-16 - Root-Level Block Scalar Indentation Calculation
**Learning:** Root-level nodes in `lightning-yaml` have a `parentCol` (and `effParentCol`) of `-1`. Adding an explicit indentation indicator `indentIndicator` directly to `effParentCol` resulted in `contentIndent = -1 + indentIndicator`, under-calculating indentation by 1 space for root-level block scalars (e.g. `|2`).
**Action:** When calculating content indentation with explicit indentation indicators, normalize `effParentCol` with `Math.max(0, effParentCol) + indentIndicator` so root-level nodes are treated as starting at column 0.
