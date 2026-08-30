## 2026-08-02 - Root-level Block Scalar Explicit Indentation
**Learning:** Root-level block scalars (where parent column sentinel is `-1`) with explicit indentation indicators (`|1`, `|2`, `>1`, `>2`) calculated content indentation as `effParentCol + indentIndicator` = `-1 + N`, under-calculating content indentation by 1 space. Using `Math.max(0, effParentCol) + indentIndicator` treats root level as column 0.
**Action:** When probing block scalar indentation or sentinel parent column handling, test both root-level and nested constructs with explicit indicators.
