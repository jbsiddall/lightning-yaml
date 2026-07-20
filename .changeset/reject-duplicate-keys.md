---
"lightning-yaml": minor
---

Reject duplicate mapping keys with a YAMLParseError (YAML 1.2 section 3.2.1.3) instead of silent last-wins. Breaking: parsing a mapping with repeated keys now throws.
