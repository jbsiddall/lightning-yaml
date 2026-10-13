---
"lightning-yaml": patch
---

The `js-yaml` `load` compatibility entry point now throws on empty, comment-only, and suffix-only input. Native `parseAll` skips standalone and repeated `...` markers, so suffix-only input returns `[]` instead of `[null]`; an explicit empty document (`---`) still returns `null`. The `yaml` compatibility wrapper preserves the reference library's document counts for suffix markers.
