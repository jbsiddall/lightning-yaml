## 2026-07-24 - Block scalar explicit indent indicator at document root
**Learning:** For block scalars at document root level (where parent column is -1 or ROOT_AFTER_INLINE_MARKER), explicit indentation indicators (1-9) must be calculated relative to parent column 0 rather than -1. Using -1 + indentIndicator under-calculates content indentation by 1 space, causing leading spaces in block scalar lines to not be stripped.
**Action:** Use Math.max(0, effParentCol) + indentIndicator when calculating contentIndent for explicit indentation indicators.
