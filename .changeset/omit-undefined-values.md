---
"lightning-yaml": patch
---

Omit mapping keys whose value is undefined on stringify (matching JSON.stringify and js-yaml) instead of emitting them as null.
