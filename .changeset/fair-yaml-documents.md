---
"lightning-yaml": minor
---

`parseDocument` and `parseAllDocuments` now return source-aware documents with YAML node contents and recoverable diagnostics. Use `doc.toJS()` or `doc.toJSON()` when your code needs ordinary JavaScript values.
