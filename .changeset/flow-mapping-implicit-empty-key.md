---
"lightning-yaml": patch
---

Fix parsing of flow mapping entries starting directly with a colon followed by a flow separator (such as `{ : v}` or `{ : }`), correctly treating them as an implicit empty key ("").
