## 2026-10-16 - Cycle tracking in complex mapping key stringification
**Learning:** Formatting complex mapping key nodes into JS object strings (`stringifyKeyNode` in `src/core.ts`) can encounter self-referential / cyclic structures (e.g. `&a [*a]: 1` or `&a {self: *a}: 1`). Without a cycle tracker, stringification causes a native `RangeError: Maximum call stack size exceeded` crash.
**Action:** When serializing complex mapping keys to string keys, pass a `visited: Set<object>` down the recursive calls (`stringifyKeyNode` and `stringifyKeyValue`) to return `"[Circular]"` on cycles.
