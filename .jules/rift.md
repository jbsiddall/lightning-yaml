# Rift Journal

## 2026-10-17 - Flow Map Implicit Empty Keys
**Learning:** Under YAML 1.2 specifications, flow mapping entries starting directly with a colon followed by a flow separator (e.g. `{ : v}`, `{: v}`, `{ : }`) represent an implicit empty key (`""`). In `parseFlowMap` (`src/core.ts`), checking `c === COLON && flowSeparatorAt(pos + 1)` allows parsing the implicit empty key before consuming the value separator.
**Action:** When probing flow mappings for edge cases, test variations of colon placement and flow separators.
