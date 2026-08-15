---
"lightning-yaml": patch
---

Fix content indentation calculation for root-level block scalars with explicit indentation indicators (e.g. `|1`, `>1`).

```yaml
# Before: parse("|1\n hello\n world") -> " hello\n world\n" (extra leading space)
# After:  parse("|1\n hello\n world") -> "hello\nworld\n"
```
