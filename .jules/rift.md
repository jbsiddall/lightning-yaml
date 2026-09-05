## 2026-09-05 - Cyclic complex mapping keys stack overflow in stringifyKeyNode
**Learning:** Parsing complex mapping keys with cyclic references (e.g. `&a\n[*a]: 1`) stringifies the key node into a JS object key string. Without cycle tracking in `stringifyKeyNode`, this causes infinite recursion and throws `RangeError: Maximum call stack size exceeded`.
**Action:** Always maintain a `visited: Set<object>` when recursively formatting JS object keys or values in key-stringifier functions.
