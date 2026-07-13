---
title: Research Overview
description: Why a from-scratch, pure-JS YAML parser can approach JSON.parse speed — and a map of the write-ups behind it.
sidebar:
  order: 1
---

This section is a living set of write-ups on how lightning-yaml is built —
the engineering decisions behind the numbers in [Benchmarks](/benchmarks/).
It's seeded with the first two articles below; more will land as further
optimizations ship. Start here for the framing, then follow the links.

## The gap this project is closing

On the same input, the established pure-JS YAML libraries are dramatically
slower than `JSON.parse` — not by a small constant factor, but by roughly an
order of magnitude (`js-yaml`) to two orders of magnitude (`yaml`), and the
gap widens as documents get larger. None of that overhead comes from YAML's
grammar being inherently harder to parse than JSON's grammar — flow-style
YAML *is* effectively JSON with a few extra literals. It comes from
implementation choices: per-node bookkeeping objects, defensive per-pair
duplicate-key checks, always-allocated metadata (anchor maps, tag
registries) whether or not a document uses the feature, string concatenation
for scalars, and multiple passes over the input.

`JSON.parse` doesn't pay any of that cost because V8 implements it in C++ as
a single pass with careful, engine-level control over allocation. A pure-JS
parser can't get that same low-level control — but it can stop fighting the
engine and start cooperating with it: scan the input in one linear pass,
avoid intermediate allocations that don't end up in the final value, and
shape the objects it builds so V8's JIT treats them the same way it would
treat hand-written object literals.

That's the thesis this section documents: implemented carefully, a pure-JS
YAML parser can approach `JSON.parse`/`JSON.stringify`'s speed and memory
profile — see [Benchmarks](/benchmarks/) for exactly how close — while still
covering the full YAML 1.2 core grammar rather than a restricted subset.
lightning-yaml backs that up on correctness too: **364/373 (97.6%)** on the
[yaml-test-suite](https://github.com/yaml/yaml-test-suite), ahead of both
the `yaml` library (362/373) and `js-yaml` (354/373), with 100% (91/91) on
the negative/error cases — the speed isn't coming at the expense of
conformance.

## In this section

- [Tokenizer & Scanning](/research/tokenizer-and-scanning/) — the
  single-pass scanner design: char-code-level scanning, batched runs, and
  why the hot loop is shaped the way it is.
- [Allocation Strategy](/research/allocation-strategy/) — how allocation is
  kept close to the shape of the output value, and why that's what actually
  controls peak memory.

See also [Parsing](/guides/parsing/) and [Stringifying](/guides/stringifying/)
for the user-facing side of the API, and the [API reference](/api/) for
exact signatures.
