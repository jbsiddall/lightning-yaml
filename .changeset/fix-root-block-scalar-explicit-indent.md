---
"lightning-yaml": patch
---

Root-level block scalars with an explicit indentation indicator now parse without an extra leading space. For example, `|2` followed by a line indented two spaces produces the text without those two spaces.
