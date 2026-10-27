---
"lightning-yaml": patch
---

Fix `RangeError: Maximum call stack size exceeded` stack overflow crash when parsing cyclic complex mapping keys (e.g. `&a [*a]: 1`). Track visited object nodes in `stringifyKeyNode` using a per-traversal `visited` set to gracefully handle cycles without call stack overflow while preserving shared non-cyclic references (DAGs).
