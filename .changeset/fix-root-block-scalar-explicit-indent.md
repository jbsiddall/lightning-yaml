---
"lightning-yaml": patch
---

Fix root-level block scalar content indentation calculation when an explicit indentation indicator is provided (e.g. `|1`, `|2`). Per YAML 1.2.2 §8.1.1 (Block Scalar Headers), explicit indentation indicators calculate content indentation relative to the parent block structure column, which is column 0 at document root. Previously, calculating `effParentCol + indentIndicator` with `effParentCol = -1` under-calculated indentation by 1 space, leaving an extra leading space in parsed scalar strings.
