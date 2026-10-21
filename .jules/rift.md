# Rift Journal

## 2026-10-13 - Cyclic Complex Mapping Key Stringification
**Learning:** Formatting complex mapping keys (`stringifyKeyNode`) into JS object property strings without cycle tracking triggers `RangeError: Maximum call stack size exceeded` when parsing self-referential/cyclic complex keys like `&a [*a]: 1`.
**Action:** Always maintain a `visited: Set<object>` recursion guard when serializing JS object keys from parsed AST nodes.
