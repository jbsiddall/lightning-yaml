---
title: Allocation Strategy & V8 Friendliness
description: How lightning-yaml keeps allocation close to the shape of the output value, so peak memory tracks JSON.parse instead of input size.
sidebar:
  order: 3
---

> **Seed article.** This is a conceptual overview of the allocation and
> memory-shape strategy, not a full walkthrough — the maintainer will expand
> it with code references and further measurements. See
> [Research Overview](/research/overview/) for context.

Parsers are usually judged on speed first, but for a YAML parser, **peak
memory is often the bigger surprise** — and it's driven far more by how much
garbage a parser allocates per byte of input than by the size of the final
value it produces.

## Why peak memory, not just heap size

The [benchmark harness](/benchmarks/) measures this directly with
whole-process peak RSS, not just per-iteration heap churn, because the gap
between the two can be enormous. On a representative run parsing the
benchmark suite's 10 MB fixture, the `yaml` library's peak resident memory
reaches roughly 2.7 GB, while its *heap allocation delta* — the number a
conventional JS benchmark tool would report — sits under 40 MB. Almost two
gigabytes of that peak is native/off-heap memory a heap-delta measurement
never sees. lightning-yaml's design goal is to avoid generating that
off-heap churn in the first place, not just to allocate a smaller heap: on
the same fixture, it holds peak RSS to roughly **1.3×** `JSON.parse`'s own,
against roughly 3.4× for `js-yaml` and close to 10× for `yaml`.

## Minimizing intermediate allocations

A lot of parser memory overhead never makes it into the final value — it's
scaffolding thrown away the moment parsing finishes: per-node metadata
objects, defensive per-pair bookkeeping for duplicate-key handling, or
always-allocated structures (anchor tables, tag registries) that exist
whether or not a given document actually uses the feature they support.
lightning-yaml avoids allocating any of that: the values it builds while
parsing *are* the result, not a wrapper around the result, and structures
that only some documents need — the anchor table used to resolve `&`/`*`,
for example — aren't allocated until a document actually contains one.

## Buffer and slice reuse — near zero-copy scalars

As covered in [Tokenizer & Scanning](/research/tokenizer-and-scanning/), a
scalar's text is captured as offsets into the source and materialized with a
single `.slice()` call. That single-slice discipline matters for memory, not
just speed: a JS engine can implement a slice of a sufficiently long string
as a lightweight view — start offset, length, and a pointer back to the
original string — rather than a fresh copy of the characters. Concatenating
a scalar together from parts (which naive parsers do whenever a value spans
an escape sequence or a folded line) forfeits that and forces a real copy;
lightning-yaml only pays for a copy on that genuinely unavoidable cold path
(escaped double-quoted content, folded block scalars), never for the common
unescaped case.

Repeated mapping keys get the same treatment one level up: parsing an array
of similarly-shaped records — rows, list entries, config blocks — means
re-encountering the same key text over and over. Rather than re-slicing and
re-hashing an identical key on every occurrence, the parser recognizes a key
it's already captured and reuses that same string reference, which both
avoids the reallocation and — see below — helps V8 treat the resulting
objects as interchangeable shapes.

## Monomorphic shapes for V8's JIT

V8 optimizes property access based on an object's "hidden class" — the
implicit shape formed by which keys it has and the order they were added.
Two objects built by assigning the same keys in the same order end up
sharing that hidden class, and V8's inline caches stay fast (monomorphic)
across a whole array of them. lightning-yaml builds mapping keys in the
order they appear in the source — the same order a plain object literal with
those keys would use — so a document that's an array of homogeneous records
(extremely common: rows of data, lists of config entries) produces objects
that all share one hidden class, rather than each falling back to slower
dictionary-mode property storage.

The same idea applies to sequences: arrays are grown with `push` rather than
pre-sized and left with holes, which keeps them in V8's "packed" elements
representation instead of the slower "holey" one, and a sequence of plain
integers naturally lands in the fastest packed-SMI representation with no
special-casing needed to get there.

## Next

- [Tokenizer & Scanning](/research/tokenizer-and-scanning/) for the scanning
  side of the design.
- [Benchmarks](/benchmarks/) for the measured numbers this strategy produces.
