---
"lightning-yaml": patch
---

Match js-yaml's default CORE profile by rejecting explicitly tagged `!!binary` scalars in `load` and `loadAll`. Native `parse` and the `yaml` compatibility entry point continue to decode binary values. Nonempty `Schema.withTags(...)` compositions now fail as unsupported when passed to the shim instead of being mistaken for the unmodified `CORE_SCHEMA`.
