---
"lightning-yaml": patch
---

The `yaml` (eemeli/yaml) compat layer now recursively traverses, mutates, and deletes elements inside JS `Set` (from `!!set`) and `Map` (from `!!omap` or `mapAsMap: true`) collections inside its JSON-style reviver callback, matching the behavior of the real `yaml` library.
