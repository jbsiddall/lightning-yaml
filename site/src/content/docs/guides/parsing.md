---
title: Parsing YAML
description: parse vs parseAll for single documents and multi-document streams, scalar typing, and error handling.
sidebar:
  order: 2
---

## `parse` vs `parseAll`

```ts
parse(source: string): unknown
parseAll(source: string): unknown[]
```

`parse` reads a **single** document. If `source` contains more than one
`---`-separated document, `parse` throws — it does not silently return just
the first one. This mirrors `JSON.parse`'s "exactly one value" contract (and
`js-yaml`'s `load`).

`parseAll` reads a **stream**: it splits `source` on `---` (document start)
and `...` (document end) markers and returns every document as an array,
in order.

```ts
import { parseAll } from "lightning-yaml";

const docs = parseAll(`
---
name: alpha
value: 1
---
name: beta
value: 2
`);

console.log(docs);
// [ { name: 'alpha', value: 1 }, { name: 'beta', value: 2 } ]
```

Use `parse` for single-document config/data files, `parseAll` for logs,
Kubernetes manifests applied as a stream, or anything else that packs
multiple documents into one source.

## How plain scalars are typed

lightning-yaml resolves plain (unquoted) scalars with the **YAML 1.2 core
schema**:

- `null` / `Null` / `NULL` / `~` and an empty value resolve to `null`;
- `true` / `True` / `TRUE` / `false` / `False` / `FALSE` (exact spellings —
  `yes` / `no` / `on` / `off` stay plain **strings**) resolve to booleans;
- decimal, `0o` octal, and `0x` hex integers, floats, and `.inf` / `.nan`
  resolve to numbers.

Timestamps are **not** auto-resolved — `date: 2026-08-02` parses as a string,
not a `Date`. Quoted scalars (`"..."`, `'...'`) are never re-typed: a quoted
`"true"` is always the string `"true"`.

## Handling parse errors

Malformed YAML throws a `YAMLParseError`. Its `message` carries the position
of the problem — rendered as `… (line L, column C)` — so you can point at the
exact spot instead of just "invalid YAML":

```ts
import { parse, YAMLParseError } from "lightning-yaml";

try {
  parse(source);
} catch (err) {
  if (err instanceof YAMLParseError) {
    console.error(`YAML error: ${err.message}`);
  } else {
    throw err;
  }
}
```

## What's not supported yet

Merge keys (`<<: *defaults`) are not implemented. lightning-yaml won't
silently mis-parse a merge key into the wrong value — it's a documented gap,
not a correctness bug — but it also won't expand the merge for you today.
Everything else in the YAML 1.2 core feature set (flow and block
collections, block scalars, anchors/aliases, tags including `!!binary`,
directives, multi-document streams) is implemented and covered by the
conformance suite — see [Benchmarks](/benchmarks/).

## Next

- [Stringifying](/guides/stringifying/) to go the other direction.
- [API reference](/api/) for the full signatures and types.
