# Rift's Journal 🌀

## 2026-03-30 - Root-Level Block Scalar Explicit Indentation Calculation
**Learning:** `effParentCol` for a root document node is `-1` (a sentinel value). When calculating `contentIndent` for a block scalar with an explicit indentation indicator digit `m` (`1`-`9`), evaluating `effParentCol + indentIndicator` produced `-1 + m`, under-counting the required indentation by 1 space at document root.
**Action:** Use `Math.max(0, effParentCol) + indentIndicator` so root-level scalars treat parent column as 0 per YAML 1.2 §8.1.1.1.
