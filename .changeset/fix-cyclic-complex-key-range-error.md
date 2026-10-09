---
"lightning-yaml": patch
---

Fix a `RangeError: Maximum call stack size exceeded` crash when parsing YAML documents that use cyclic complex mapping keys (such as `&a [*a]: 1` or `&a {a: *a}: 1`). Complex keys containing self-referential structures are now safely serialized with placeholder ellipses (`...`) during JS key coercion without overflowing the call stack.
