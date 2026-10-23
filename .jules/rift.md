## 2026-07-23 - Flow mapping implicit empty keys
**Learning:** In YAML 1.2 flow mappings, an entry starting directly with a colon followed by a flow separator (e.g. `{ : v}`, `{: v}`, `{ : }`) represents an implicit empty key (""). In `lightning-yaml`, `parseFlowKey` failed to check if `pos` was directly on a colon separator, causing it to attempt plain scalar scanning and fail with `expected a mapping key`.
**Action:** When probing flow mappings, test edge case indicator positions like `{ : }`, `[ : ]`, `{ ? : }`, and `{ : , a: b }`.
