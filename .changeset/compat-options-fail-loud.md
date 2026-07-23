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

Options that are genuine no-ops today keep working unchanged — the `parse` reviver, `filename`, and
`schema` / `version` at their YAML-1.2-core defaults, plus any boolean flag left at the value
lightning-yaml already produces (for example `mapAsMap: false` or `sortKeys: false`). Anything that
would actually change the output — a different schema, a custom `indent`, `sortKeys: true` — throws
until its support lands, so you find out at the call site instead of downstream.
