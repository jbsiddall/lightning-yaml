## 2026-03-31 - Flow mapping implicit colon key
**Learning:** Under YAML 1.2 §7.3.2 and Spec Example 7.3 (FRK4), a flow mapping entry starting directly with a colon followed by a flow separator (`{: v}`, `{ : v}`, `{:}`) represents an implicit empty key (`""`).
**Action:** When parsing flow mappings, check for `c === COLON && flowSeparatorAt(pos + 1)` at entry start to handle implicit empty keys.
