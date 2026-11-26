---
"lightning-yaml": minor
---

A carriage return on its own inside a quoted string is a line break in the [YAML spec](https://yaml.org/spec/1.2.2/#54-line-break-characters), so it should fold to a space like a newline. Plain `parse` and `lightning-yaml/yaml` keep it as text, as the `yaml` library does. Before, plain `parse` folded it only when the string also held an escape or a newline, so `"a<CR>b\n"` was `"a b\n"` and is now `"a\rb\n"`. With `{ strict: true }` and in `lightning-yaml/js-yaml` it folds, as in js-yaml: `"a<CR>b\n"` gives `"a b\n"`, the next line of a quoted value in a block mapping must be indented, and `"a<CR>b": 1` is an error because a key cannot span lines.

With `{ strict: true }`, and always in `lightning-yaml/js-yaml`, a raw control character inside a quoted string (U+0000 to U+001F, except tab, LF and CR) is now an error, as the [spec requires](https://yaml.org/spec/1.2.2/#51-character-set) and js-yaml does. Plain `parse` and `lightning-yaml/yaml` still accept it, like the `yaml` library.

```yaml
# <CR> is a raw carriage return, <NUL> a raw NUL byte
a: "one<CR>  two"   # parse: "one\r  two"; strict or js-yaml: now "one two"
b: "x<NUL>y"        # parse: unchanged; strict or js-yaml: now an error, write "x\0y"
```

Strict mode and `lightning-yaml/js-yaml` now read every quoted string in full to check it, so quote-heavy input parses slower there; plain `parse` does no extra scan.
