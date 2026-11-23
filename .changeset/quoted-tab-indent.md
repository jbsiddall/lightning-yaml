---
"lightning-yaml": patch
---

A quoted value inside a block mapping or sequence that continues onto a line indented with a tab (instead of spaces) is now rejected in both default and `strict: true` modes, as the [YAML spec requires](https://yaml.org/spec/1.2.2/#61-indentation-spaces). This includes a blank line holding only a tab. Top-level quoted values are unaffected.

```yaml
# before: parsed as { foo: "bar baz" }   after: error
foo: "bar
	baz"
```
