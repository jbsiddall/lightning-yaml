---
"lightning-yaml": minor
---

`parseDocument()` and `parseAllDocuments()` now return editable YAML documents
with native nodes in `.contents`. Convert a document to JavaScript with
`doc.toJS()`.

Root block scalars with an explicit indentation digit now retain the extra leading spaces required at the document root. For example, `|2` with two spaces before `hello` resolves to ` hello`.
