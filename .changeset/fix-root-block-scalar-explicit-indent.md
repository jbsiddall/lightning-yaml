---
"lightning-yaml": patch
---

Fix block scalar parsing when an explicit indentation indicator (e.g. `|2`, `>2`) is specified at the document root level. Previously, root-level parent column calculation under-calculated indentation by 1 space, leaving an extra leading space on every content line.

```yaml
# Before: returned " line1\n line2\n"
# After: returns "line1\nline2\n"
|2
  line1
  line2
```
