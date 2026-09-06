## 2026-08-02 - Document-end marker stringification
**Learning:** String scalars starting with `...` (document end marker) followed by whitespace or end-of-string cannot be emitted as bare plain scalars in `stringify()`. When unquoted, `parse("...")` consumes it as a document-end marker and evaluates to `null` instead of the string `"..."`.
**Action:** When updating `isPlainScalarSafe` in `src/core.ts`, check for `...` prefix and force quoting for document markers.
