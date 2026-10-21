# Rift's Journal 🌀

## 2026-10-19 - Flow mapping implicit empty keys
**Learning:** Flow mapping entries starting directly with a colon followed by a flow separator/whitespace (e.g. `{ : v}`, `{ : }`, `{: v}`) represent an implicit empty string key `""` under YAML 1.2 specifications. `parseFlowMap` needs explicit handling for `c === COLON && flowSeparatorAt(pos + 1)` similar to `parseFlowSeq`.
**Action:** Check that both flow maps and flow sequences handle implicit empty keys (`:`) uniformly.
