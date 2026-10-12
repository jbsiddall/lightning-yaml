---
"lightning-yaml": patch
---

The js-yaml load compatibility entry point now throws on empty, comment-only, and suffix-only input. An explicit empty document such as --- still loads as null, and loadAll returns [] when the stream contains no document.
