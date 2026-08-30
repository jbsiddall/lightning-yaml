---
"lightning-yaml": patch
---

Fix content indentation calculation for root-level block scalars with explicit indentation indicators.

Root-level block scalars specifying an explicit indentation indicator (such as `|1`, `|2`, `>1`, `>2`) now correctly calculate content indentation relative to column 0:

```yaml
|2
  hello
  world
```

Previously, internal parent column sentinel `-1` was used directly, resulting in under-calculating indentation by 1 space and retaining unwanted leading spaces or failing parsing.
