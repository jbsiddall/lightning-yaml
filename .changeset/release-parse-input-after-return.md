---
"lightning-yaml": patch
---

`parse` and `parseAll` no longer keep the last YAML string they read in memory after returning. Before, a large input stayed alive until the next call, even though the result no longer needed it.
