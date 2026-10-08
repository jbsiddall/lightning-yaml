---
"lightning-yaml": patch
---

Deeply nested mapping keys no longer grow exponentially or crash parsing. A missing value inside a key also stays missing: `? ? a` keeps the inner key as `{ a }`, instead of `{ a: null }`.
