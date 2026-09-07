## 2026-07-23 - Implicit Empty Flow Mapping Keys
**Learning:** In YAML 1.2 flow mappings, a mapping entry starting directly with a colon followed by a flow separator/whitespace (e.g. `{ : v}` or `{: v}`) represents an implicit empty string key `""`. In `parseFlowKey`, checking `if (c === COLON && flowSeparatorAt(pos + 1))` ensures that `""` is returned as the key without throwing `YAMLParseError: expected a mapping key`.
**Action:** When auditing flow mapping key parsing, ensure both explicit `?` empty keys and implicit `:` empty keys are verified.
