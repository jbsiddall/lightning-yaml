---
"lightning-yaml": patch
---

Fix stack overflow (RangeError) when parsing cyclic complex mapping keys by adding cycle tracking to key node stringification.
