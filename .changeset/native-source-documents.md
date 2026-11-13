---
"lightning-yaml": minor
---

`parseDocument()` and `parseAllDocuments()` now return editable YAML documents
with native nodes in `.contents`. Convert a document to JavaScript with
`doc.toJS()`.
