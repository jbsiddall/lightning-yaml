---
"lightning-yaml": minor
---

A carriage return on its own inside a quoted string is now a line break, the same as a newline, as the [YAML spec says](https://yaml.org/spec/1.2.2/#54-line-break-characters). Before, it stayed in the value as `\r`, unless the string also held an escape or a newline. As with a newline, the next line of a quoted value inside a block mapping must now be indented.

With `{ strict: true }`, and always in `lightning-yaml/js-yaml`, a raw control character inside a quoted string (NUL, backspace and the other ASCII control characters except tab) is now an error, as the [spec requires](https://yaml.org/spec/1.2.2/#51-character-set) and js-yaml does. Plain `parse` and `lightning-yaml/yaml` still accept it, like the `yaml` library.

```yaml
# <CR> is a raw carriage return, <NUL> a raw NUL byte
a: "one<CR>  two"   # before: "one\r  two"   after: "one two"
b: "x<NUL>y"        # parse: unchanged; strict or js-yaml: now an error, write "x\0y"
```
