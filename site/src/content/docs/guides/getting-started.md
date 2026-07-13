---
title: Getting Started
description: Install lightning-yaml and parse your first YAML document in under a minute.
sidebar:
  order: 1
---

lightning-yaml is a YAML parser and serializer for TypeScript and JavaScript. It
implements the YAML 1.2 core schema — flow and block syntax, quoting and
escapes, comments, anchors/aliases, block scalars, tags, and multi-document
streams — and targets `JSON.parse`/`JSON.stringify`-class speed and memory
rather than the 10–100× overhead typical of JS YAML libraries. See
[Research](/research/overview/) for how, and [Benchmarks](/benchmarks/) for
the numbers.

## Install

```sh
pnpm add lightning-yaml
```

## Your first parse

```ts
import { parse } from "lightning-yaml";

const config = parse(`
name: lightning-yaml
version: 1
stable: true
tags: [parser, yaml, performance]
limits:
  maxAliasCount: 100
  timeout: null
`);

console.log(config);
// {
//   name: 'lightning-yaml',
//   version: 1,
//   stable: true,
//   tags: [ 'parser', 'yaml', 'performance' ],
//   limits: { maxAliasCount: 100, timeout: null }
// }
```

`parse` reads exactly one document and returns a plain JS value — strings,
numbers, booleans, `null`, arrays, and objects, typed per the YAML 1.2 core
schema (so `version: 1` is a `number`, `stable: true` is a `boolean`, and
`timeout: null` is `null`, not the string `"null"`). For source that may
contain more than one `---`-separated document, use `parseAll` — see
[Parsing](/guides/parsing/).

## Your first stringify

```ts
import { stringify } from "lightning-yaml";

const doc = stringify({
  name: "lightning-yaml",
  version: 1,
  tags: ["parser", "yaml"],
});

console.log(doc);
// name: lightning-yaml
// version: 1
// tags:
//   - parser
//   - yaml
```

`stringify` is the inverse of `parse`: a JS value in, block-style YAML text
out. See [Stringifying](/guides/stringifying/) for the formatting options.

## Typing the result with generics

`parse` is generic — `parse<T = unknown>(source: string, options?: ParseOptions): T`
— so you can annotate the shape you expect instead of narrowing an `unknown`
by hand:

```ts
interface Config {
  name: string;
  version: number;
  stable: boolean;
}

const config = parse<Config>(source);
config.version.toFixed(0); // typed as number, no cast needed
```

`T` only affects the *static* type — like `JSON.parse`, lightning-yaml does
not validate that the parsed value actually matches `T` at runtime. For
untrusted input, pair `parse` with a runtime validator (e.g. Zod) rather than
trusting the generic alone.

## Where to go next

- [Parsing](/guides/parsing/) — `parse` vs `parseAll`, `isValid`, schema
  selection, warnings, and error handling.
- [Stringifying](/guides/stringifying/) — formatting options and round-tripping.
- [API reference](/api/) — the full exported surface.
- [Benchmarks](/benchmarks/) — speed and memory versus `JSON`, `js-yaml`, and `yaml`.
