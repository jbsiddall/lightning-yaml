---
"lightning-yaml": patch
---

A quoted string containing a raw control character (such as a NUL or backspace byte) is now rejected, as the [YAML spec requires](https://yaml.org/spec/1.2.2/#51-character-set). Write it as an escape instead. A bare carriage return inside a quoted string is now a line break like any other, so it folds to a space.

```yaml
# before: parsed with a raw NUL byte inside   after: error
a: "x<NUL>y"
# write this instead
a: "x\0y"
```
