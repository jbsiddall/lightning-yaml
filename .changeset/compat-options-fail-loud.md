---
"lightning-yaml": minor
---

Compat shims now fail loud on options they don't support yet

The `./yaml` and `./js-yaml` drop-in entries used to accept every option and
silently ignore the ones they couldn't honour — so a call that relied on an
option quietly produced the wrong output. They now validate the option bag and
throw a clear error that names the unsupported option instead.

```js
import { dump } from "lightning-yaml/js-yaml";

// before: silently ignored `sortKeys`, emitted unsorted YAML
// now: throws, naming the unsupported option
dump(value, { sortKeys: true });
```

Options that are genuine no-ops today keep working unchanged: js-yaml's
`filename`, the default `CORE_SCHEMA`, and `json: true`; the `yaml` `parse`
reviver; and `schema: "core"` / `version: "1.2"`. Everything else throws until
its support lands, so you find out at the call site instead of downstream.
