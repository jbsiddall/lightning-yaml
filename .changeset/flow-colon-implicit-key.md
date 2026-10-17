---
"lightning-yaml": patch
---

Fix parsing of flow mapping entries starting directly with a colon `:` (such as `{: v}`). Previously, this threw a `YAMLParseError`, but now correctly parses as an implicit empty key `""`.
