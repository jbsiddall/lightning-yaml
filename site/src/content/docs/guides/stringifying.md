---
title: Stringifying YAML
description: Turn JS values back into YAML text with stringify, including anchors for shared references and round-tripping.
sidebar:
  order: 3
---

```ts
stringify(value: unknown): string
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

`stringify` emits block-style YAML with the conventional 2-space indent and
keys in the value's own insertion order.

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
