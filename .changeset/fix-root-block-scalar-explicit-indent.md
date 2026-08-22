---
"lightning-yaml": patch
---

Fix block scalar explicit indentation indicator calculation at document root (`|2`). When parsing a root-level block scalar with an explicit indentation indicator, content indentation is calculated relative to column 0 instead of `-1`, ensuring leading indentation spaces are correctly stripped per YAML 1.2 §8.1.1.1.
