---
"lightning-yaml": patch
---

Fix content indentation calculation for root-level block scalars that specify an explicit indentation indicator (such as `|2` or `|-2`).

Previously, parsing a root-level block scalar with an explicit indentation indicator (e.g. `|2\n  text\n`) under-calculated the content indentation by 1 space because the root-level parent column (`-1`) was used directly without normalizing to column `0`. This resulted in an unwanted leading space in the parsed string (`" text\n"` instead of `"text\n"`).

```yaml
# Before: parsed as " text\n"
# After:  parsed as "text\n"
|2
  text
```
