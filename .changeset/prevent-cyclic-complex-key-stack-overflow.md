---
"lightning-yaml": patch
---

Fix call stack overflow crash when parsing cyclic complex mapping keys.

```yaml
? &a [*a]
: 1
```
