---
"lightning-yaml": patch
---

`parse` and `parseAll` no longer hold on to the YAML text you give them once they return or throw. Before, the last input stayed in memory until the next call, even after you had dropped the result. The `lightning-yaml/js-yaml` and `lightning-yaml/yaml` entry points get the same fix.

One thing is unchanged: a string value in the result can share memory with the whole input, so while you hold that value the input stays in memory too. In Node.js this applies to string values of 13 or more characters.
