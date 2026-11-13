---
"lightning-yaml": minor
---

Reject space-then-tab sequences used as block indentation, per [YAML 1.2.2 §6.1](https://yaml.org/spec/1.2.2/#61-indentation-spaces), when parsing with `{ strict: true }`; such input is accepted unconditionally otherwise.

Full spec rejection of this costs ~4-8% of block-YAML parse time (more on deep, many-entry input), which is why it's opt-in via `strict` rather than the default — see the separate changeset introducing that option for the full lenient-by-default story. Valid input parses identically in both modes: `strict` only ever turns an acceptance into a rejection, never changes how a well-formed document is interpreted.
