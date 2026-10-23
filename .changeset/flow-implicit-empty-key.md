---
'lightning-yaml': patch
---

Fix flow mapping parsing for implicit empty keys starting directly with a colon (e.g. `{ : value }`).
