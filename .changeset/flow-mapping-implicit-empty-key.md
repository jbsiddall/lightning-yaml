---
"lightning-yaml": patch
---

Support flow mapping entries starting directly with a colon indicator (e.g. `{ : 1 }`, `{: 1}`, `{ : }`, `{:}`) per [YAML 1.2.2 §7.3.2](https://yaml.org/spec/1.2.2/#732-flow-mapping-entries), resolving the implicit empty key to `""`.
