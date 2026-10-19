## 2026-10-10 - Cyclic Complex Mapping Key Call Stack Overflow
**Learning:** Parsing cyclic complex mapping keys (e.g. `&a [*a]: 1` or `&a {k: *a}: 1`) passed self-referential AST objects to `keyToString` / `stringifyKeyNode`, which lacked cycle tracking and caused an unhandled `RangeError: Maximum call stack size exceeded`.
**Action:** Always maintain a `visited` object set in recursive object formatting/stringification routines when converting arbitrary YAML AST nodes into JS key representations.
