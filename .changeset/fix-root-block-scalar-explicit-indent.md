---
"lightning-yaml": patch
---

Fix explicit indentation indicator calculation for root-level block scalars (e.g. `|2`).

Root-level block scalars with explicit indentation indicators now strip the correct number of indentation spaces rather than under-calculating indentation by 1 space.
