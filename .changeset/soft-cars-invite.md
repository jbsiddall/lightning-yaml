---
"lightning-yaml": patch
---

Reject quoted keys split across LF/CRLF source lines in compact mappings inside sequences and in block mappings, including tagged keys and backslash continuations across physical source lines. Multiline quoted values and explicitly marked keys remain valid.
