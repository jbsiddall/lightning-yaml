---
"lightning-yaml": patch
---

Fix root-level block scalar parsing when an explicit indentation indicator is specified (`|1`, `|2`, `|+1`, `|-1`). Previously, explicit indentation on root-level block scalars under-calculated content indentation by 1 space, leaving leading spaces in the parsed string scalar; explicit indentation indicators now correctly calculate content indentation starting from column 0.
