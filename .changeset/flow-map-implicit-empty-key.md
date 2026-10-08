---
"lightning-yaml": patch
---

Fix flow mapping entries starting with a colon and flow separator (`{ : v}`, `{: v}`) to parse as implicit empty keys (`""`).
