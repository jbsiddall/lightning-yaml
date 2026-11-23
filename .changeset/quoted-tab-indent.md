---
"lightning-yaml": patch
---

A quoted value that continues onto a line indented with a tab (instead of spaces) is now rejected, as the [YAML spec requires](https://yaml.org/spec/1.2.2/#61-indentation-spaces). Top-level quoted values are unaffected.

```yaml
# before: parsed as { foo: "bar baz" }   after: error
foo: "bar
	baz"
```
