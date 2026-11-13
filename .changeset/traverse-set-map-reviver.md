---
"lightning-yaml": minor
---

The `yaml` compatibility parser now visits the members of `!!set` and `!!omap` in reviver callbacks, allowing callbacks to change or remove them. Reviver keys are typed as `unknown`, because set items and map keys may be non-string values.
