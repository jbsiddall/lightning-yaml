---
"lightning-yaml": patch
---

Fix indentation calculation for root-level block scalars with explicit indentation indicators (e.g. `|2` or `--- |2`).

Previously, root-level block scalars specifying an explicit indentation indicator under-calculated indentation by 1 space, causing extra leading whitespace to be retained in the parsed string.

```yaml
# Before: parsed as " foo\n"
# Now:    parsed as "foo\n"
|2
  foo
```
