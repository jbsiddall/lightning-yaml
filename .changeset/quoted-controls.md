---
"lightning-yaml": minor
---

A quoted string containing a raw ASCII control byte (0x00 to 0x1F, such as NUL or backspace, but not TAB or a line break) is now rejected, as the [YAML spec requires](https://yaml.org/spec/1.2.2/#51-character-set). Write the byte as an escape in a double-quoted string instead. A bare carriage return inside a quoted string is now a line break like any other, so it folds to a space.

```yaml
# before: parsed with a raw NUL byte inside   after: error
a: "x<NUL>y"
# write this instead
a: "x\0y"
```
