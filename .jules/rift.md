# Rift Journal - Adversarial Learnings

## 2026-10-27 - Cyclic complex mapping keys stack overflow in `stringifyKeyNode`
**Learning:** Parsing cyclic complex mapping keys (e.g. `&a [*a]: 1`) causes `parse` to recursively convert the key node into a JS string via `stringifyKeyNode`. Without cycle tracking in `stringifyKeyNode`, recursive key formatting hits `RangeError: Maximum call stack size exceeded`.
**Action:** When inspecting complex mapping key formatting or stringification functions in parsers, always verify that `visited` sets manage depth-first traversal state with `try { ... } finally { visited.delete(node); }` so cycles are cleanly detected without breaking non-cyclic DAGs.
