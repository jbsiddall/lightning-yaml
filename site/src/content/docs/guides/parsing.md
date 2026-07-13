---
title: Parsing YAML
description: parse vs parseAll, isValid, schema selection, warnings, alias safety, and error handling.
sidebar:
  order: 2
---

## `parse` vs `parseAll`

```ts
parse<T = unknown>(source: string, options?: ParseOptions): T
parseAll(source: string, options?: ParseOptions): unknown[]
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

## Validating without throwing

```ts
isValid(source: string, options?: ParseOptions): boolean
```

`isValid` reports whether `source` would parse successfully, without handing
back (or making you hold onto) the parsed value, and without throwing. Reach
for it when you only need a yes/no answer — a form field, a pre-commit lint
check, a "does this look like YAML" gate before the real parse happens
elsewhere:

```ts
import { isValid, parse } from "lightning-yaml";

if (!isValid(userInput)) {
  throw new Error("not valid YAML");
}
const value = parse(userInput);
```

`isValid` respects the same `ParseOptions` as `parse` — a document that's
only valid under a particular `schema`, for instance, should be checked with
that same option set.

## `ParseOptions`

```ts
interface ParseOptions {
  schema?: Schema;
  onWarning?: (w: YAMLWarning) => void;
  maxAliasCount?: number;
}

type Schema = "core" | "json" | "failsafe" | "yaml-1.1";
```

### `schema` — how plain scalars are typed

Default: `'core'`.

- **`'core'`** — the YAML 1.2 core schema. `null`/`Null`/`NULL`/`~` and an
  empty value resolve to `null`; `true`/`True`/`TRUE`/`false`/`False`/`FALSE`
  (exact case — `yes`/`no`/`on`/`off` stay plain strings) resolve to
  booleans; decimal/`0o`/`0x` integers, floats, and `.inf`/`.nan` resolve to
  numbers. Timestamps are **not** auto-resolved — `date: 2026-08-02` parses
  as a string, not a `Date`. This is the default, and the schema the rest of
  this site assumes.
- **`'json'`** — restricts scalar resolution to what JSON itself allows, for
  when you're treating YAML strictly as "JSON with a friendlier syntax."
- **`'failsafe'`** — no scalar resolution at all: every plain scalar is a
  string, and only maps/sequences/strings exist. The most conservative
  option when you want to do your own typing downstream.
- **`'yaml-1.1'`** — the legacy typing rules many JS YAML libraries default
  to historically (`yes`/`no`/`on`/`off` as booleans, sexagesimal ints,
  etc.). Use it for compatibility with documents authored against those
  defaults, not for new documents.

Quoted scalars (`"..."`, `'...'`) are never re-typed by any schema — a quoted
`"true"` is always the string `"true"`.

### `onWarning` — recoverable issues

```ts
interface YAMLWarning {
  message: string;
  line: number;
  column: number;
}
```

Some issues (a duplicate key in a mapping, for example) don't make a
document unparseable — YAML, and this parser, can recover and produce a
best-effort value. `onWarning` is called for each of these instead of
silently ignoring them, so you can log, collect, or fail a build on
conditions that a plain `try`/`catch` around `parse` would never see (the
parse succeeds; it also warns).

```ts
parse(source, {
  onWarning: (w) => console.warn(`${w.message} (${w.line}:${w.column})`),
});
```

### `maxAliasCount` — alias-expansion safety

Anchors and aliases (`&name`, `*name`) let a YAML document reference the
same node from multiple places. Read naively, a small, deliberately-crafted
document can reference a handful of anchors from many places, each of which
references more anchors, and so on — expanding to an enormous in-memory
structure from a tiny source file (YAML's analogue of a "billion laughs" XML
bomb). `maxAliasCount` bounds how many alias references a document may
contain before parsing aborts, so untrusted input can't turn a few hundred
bytes into a memory-exhaustion attack. It carries a conservative default;
raise it explicitly — see the [API reference](/api/) for the exact default
and any "unlimited" sentinel value — only for sources you trust that
legitimately reuse anchors heavily.

## Handling parse errors

```ts
class YAMLParseError extends Error {
  line: number;
  column: number;
}
```

Malformed YAML throws a `YAMLParseError` carrying the position of the
problem, so you can point at the exact line instead of just "invalid YAML":

```ts
import { parse, YAMLParseError } from "lightning-yaml";

try {
  parse(source);
} catch (err) {
  if (err instanceof YAMLParseError) {
    console.error(`YAML error at ${err.line}:${err.column} — ${err.message}`);
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
