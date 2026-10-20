# Rift's Journal

Adversarial YAML Conformance Hunter Learnings.

## 2026-10-20 - Root-level block scalar explicit indentation indicator calculation
**Learning:** Root-level block scalars (where `effParentCol = -1`) with an explicit indentation indicator `1..9` (e.g. `|1\n line1\n`) previously calculated `contentIndent` as `effParentCol + indentIndicator` (`-1 + 1 = 0`), under-calculating indentation by 1 space and leaving leading spaces on content lines.
**Action:** Use `Math.max(0, effParentCol) + indentIndicator` so parent indentation at document root defaults to column 0.
