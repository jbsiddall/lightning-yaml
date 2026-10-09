---
"lightning-yaml": patch
---

Move the YAML parser and serializer implementation into a generated Dafny engine while preserving the existing TypeScript API. The replacement currently matches the baseline functional and compatibility gates. Performance acceptance is still pending; no speedup is claimed.
