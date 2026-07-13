---
title: Stringifying YAML
description: Turn JS values back into YAML text with stringify and StringifyOptions.
sidebar:
  order: 3
---

```ts
stringify(value: unknown, options?: StringifyOptions): string
```

`stringify` serializes a JS value — strings, numbers, booleans, `null`,
arrays, plain objects, and `Uint8Array` (emitted as `!!binary`) — to
block-style YAML text.

```ts
import { stringify } from "lightning-yaml";

console.log(
  stringify({
    service: "api",
    replicas: 3,
    env: ["NODE_ENV=production", "PORT=8080"],
  }),
);
// service: api
// replicas: 3
// env:
//   - NODE_ENV=production
//   - PORT=8080
```

## `StringifyOptions`

```ts
interface StringifyOptions {
  indent?: number;
  sortKeys?: boolean;
  lineWidth?: number;
}
```

- **`indent`** — spaces per nesting level. Defaults to the conventional
  2-space YAML indent.
- **`sortKeys`** — when `true`, object keys are emitted in sorted order
  instead of insertion order. Useful for deterministic output — stable
  diffs, snapshot tests, reproducible config generation — where two
  semantically-identical objects built in a different order should still
  serialize identically.
- **`lineWidth`** — the column width the dumper tries to wrap long scalars
  at. Set it higher (or to a value comfortably larger than anything in your
  data) if scalars need to stay on one line regardless of length.

```ts
stringify(value, { indent: 4, sortKeys: true });
```

## Round-tripping

For JSON-shaped data, `parse` and `stringify` round-trip:

```ts
import { parse, stringify } from "lightning-yaml";

const original = `
service: api
replicas: 3
env:
  - NODE_ENV=production
  - PORT=8080
`;

const value = parse(original);
const text = stringify(value);

parse(text); // deep-equal to `value`
```

This holds for richer documents too — `stringify` emits anchors/aliases for
values that share a reference (or form a cycle) rather than duplicating
them, so `parse(stringify(x))` reconstructs the same shared-reference graph,
not a deep copy of it.

## Performance

`stringify` is tuned for throughput, not just correctness — it approaches
`JSON.stringify`'s speed in the sense that matters most: it stays within a
single order of magnitude of it (roughly 5× the time, on record-shaped
data), rather than the tens-of-times-slower results `js-yaml` and `yaml`
produce on the same data, and it does so at lower peak memory than either
competitor. See [Benchmarks](/benchmarks/) for the full head-to-head, and
[Allocation Strategy](/research/allocation-strategy/) for why.

## Next

- [Parsing](/guides/parsing/) for the reverse direction.
- [API reference](/api/) for the full signatures and types.
