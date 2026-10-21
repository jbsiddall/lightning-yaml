## 2026-07-20 - Cyclic complex mapping keys stack overflow in stringifyKeyNode

**Learning:** When complex mapping keys contain circular references (e.g. `? &a [*a]\n: 1`), `stringifyKeyNode` in `src/core.ts` recurses into nested structures without cycle tracking, causing an uncaught `RangeError: Maximum call stack size exceeded`.
**Action:** Always maintain a `visited: Set<object>` parameter when formatting complex mapping key nodes in `stringifyKeyNode` to break recursion cycles gracefully.
