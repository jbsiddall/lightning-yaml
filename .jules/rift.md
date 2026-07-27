# Rift's Adversarial YAML Conformance Hunt Journal

## 2026-07-24 - JS Object properties with undefined values and custom Map/Set revival
**Learning:**
1. In JS YAML dumpers, `undefined` values in object properties are completely omitted from the serialized map, but sequence (array) items with `undefined` values are serialized as `null` to match standard JSON/YAML serialization behaviors.
2. The `yaml` (eemeli) library's JSON-style reviver callback recursively traverses and mutates custom `Set` (!!set) and `Map` (!!omap) collections. When elements are mutated or deleted, in-place mutation of the collection is required to maintain correct insertion-order preservation (standard JS Set/Map order preservation behavior).

**Action:**
1. When designing stringifiers, verify `undefined` property omission and sequence null-mapping boundaries.
2. In compat shims for `yaml`'s `applyReviver`, ensure Maps and Sets are handled recursively with the proper `this` context and proper in-place deletion or update mechanics.
