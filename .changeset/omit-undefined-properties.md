---
"lightning-yaml": patch
---

Omit `undefined` object properties during stringification

JavaScript object properties with `undefined` values are now completely omitted
from the serialized map, matching standard JSON and YAML serialization behaviors,
while array items with `undefined` values continue to be serialized as `null`.
