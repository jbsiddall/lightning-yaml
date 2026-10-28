## 2026-07-24 - Implicit Empty Keys in Flow Mappings
**Learning:** Flow mapping entries starting directly with a colon followed by a flow separator (e.g., `{ : v}`, `{: v}`, `{ : }`) represent implicit empty keys ("").
**Action:** When parsing flow mapping keys (`parseFlowKey`, `parseFlowKeyAnchored`), check if `c === COLON && flowSeparatorAt(pos + 1)` to handle implicit empty keys before attempting plain scalar scanning.
