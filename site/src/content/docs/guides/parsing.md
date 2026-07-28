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

## Strict vs. lenient parsing

By default, `parse` and `parseAll` are **lenient** about one spec-invalid
construct: a tab used to indent a block sequence or mapping ([YAML 1.2.2
§6.1](https://yaml.org/spec/1.2.2/#61-indentation-spaces) forbids it, but
real-world YAML sometimes has it anyway). Pass `{ strict: true }` to reject
that input instead:

```ts
import { parse } from "lightning-yaml";

const withTab = "a:\n\tb: 1\n"; // a tab indenting "b"

parse(withTab); // { a: { b: 1 } } — accepted by default
parse(withTab, { strict: true }); // throws YAMLParseError
```

Lenient parsing never changes how a *valid* document is read — it only
widens what's accepted; `strict: true` narrows it back to the spec.

## Merge keys (`<<`)

`parse` and `parseAll` resolve `<<: *anchor` / `<<: [*a, *b]` merge keys
([`tag:yaml.org,2002:merge`](https://yaml.org/type/merge.html)) by default,
splicing the aliased mapping's keys into the current one at the point `<<`
appears:

```ts
import { parse } from "lightning-yaml";

const source = `
defaults: &d
  adapter: postgres
  host: localhost
development:
  <<: *d
  database: dev_db
`;

parse(source).development;
// { adapter: "postgres", host: "localhost", database: "dev_db" }
```

A mapping's own keys always win over a merged one, whether written before or
after the `<<` line; if `<<` appears more than once in the same mapping, the
earlier occurrence wins on any key the two share.

`<<` is a YAML 1.1 construct, not part of the YAML 1.2 core schema. Both
js-yaml and `yaml` require an explicit opt-in and leave it unmerged by
default, so lightning-yaml treating it as on by default is a deliberate
divergence from both — real-world YAML depends on `<<` often enough to make
that the more useful default. Pass `{ merge: false }` to turn it off and get
the pre-merge reading instead: `<<` becomes an ordinary literal `"<<"`
string key, neither expanded nor rejected.

```ts
parse(source, { merge: false }).development;
// { "<<": { adapter: "postgres", host: "localhost" }, database: "dev_db" }
```

## Next

- [Stringifying](/guides/stringifying/) to go the other direction.
- [API reference](/api/) for the full signatures and types.
