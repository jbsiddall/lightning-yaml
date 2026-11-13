---
"lightning-yaml": minor
---

Parse tagged or anchored block sequences used as explicit mapping keys and values. The js-yaml compatibility API now rejects collection-valued mapping keys, matching js-yaml; previously it converted them to strings.
