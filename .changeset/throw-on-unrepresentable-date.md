---
"lightning-yaml": minor
---

stringify now throws a YAMLParseError when given a Date instead of silently emitting an empty map. YAML 1.2 core has no timestamp type, so a Date has no faithful representation; throwing (matching js-yaml's CORE_SCHEMA) is more honest than inventing an ISO-8601 string that only round-trips under YAML 1.1.
