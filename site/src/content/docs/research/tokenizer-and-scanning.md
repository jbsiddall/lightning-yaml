---
title: Tokenizer & Scanning
description: How lightning-yaml scans YAML source in a single linear pass, without a separate tokenization phase.
sidebar:
  order: 2
---

> **Seed article.** This is a conceptual overview of the scanner design, not
> a full walkthrough — the maintainer will expand it with code references
> and measurements. See [Research Overview](/research/overview/) for context.

Most hand-written parsers split cleanly into a tokenizer (source text →
array of tokens) and a parser (tokens → value). That split is convenient to
write, but it costs a full extra pass over the input and an intermediate
allocation — an array of token objects — proportional to the size of the
document, thrown away as soon as parsing finishes. lightning-yaml doesn't do
this: scanning and parsing are the same pass. There's no token array; the
recursive-descent parser reads characters directly off the source string and
decides what it's looking at as it goes.

## Char-code-level scanning

The scanner never turns the input into an array of substrings, and never
decodes it into bytes. It walks the source as a flat JS string, reading one
UTF-16 code unit at a time with `charCodeAt` and comparing against numeric
constants, rather than testing substrings or running regexes in the hot
loop. Position is just an integer offset into that string.

This matters for allocation, not just speed: the naive way to build up a
token's text is to append to a string or array one character at a time while
scanning, which allocates repeatedly for every scalar in the document. Here,
a scalar is captured as a `(start, end)` offset pair while scanning, and
turned into an actual string with exactly one `.slice()` call once its
extent is known — the scanning phase touches the source, but doesn't
allocate on its account.

A small lookup table, indexed by character code, marks which codes are
structurally significant (flow indicators, plain-scalar terminators, and so
on). Checking "is this character special" against that table is a single
array read rather than a chain of `===` comparisons, and it stays
branch-lean regardless of how many special characters YAML's grammar
defines.

## Batching runs instead of looping character-by-character

A YAML document is mostly *not* special characters — long runs of ordinary
plain-scalar text, indentation whitespace, comment bodies. Stepping through
those one `charCodeAt` call at a time is wasted work when the only question
is "where does this run end." Instead, the scanner looks for the next
character *that matters* — the next newline, the next unescaped quote, the
next flow indicator — using `String.prototype.indexOf`, which V8 implements
internally with a vectorized, SIMD-class search (the same family as libc's
`memchr`) rather than a naive per-character loop. Skipping a 200-character
run of plain-scalar body becomes one native call instead of 200 interpreted
comparisons.

This is a deliberate choice to stay on the string representation rather than
transcode to a byte buffer first: raw `Uint8Array` scanning can be faster
than `charCodeAt` in isolation, but paying to transcode the *entire* input
to bytes up front costs more than that raw-scan advantage recovers for a
parser that mostly needs to test individual characters and hop over runs,
not stream-process bytes. Byte-level access is reserved for where it's
unavoidable — decoding `!!binary` payloads — rather than used for scanning
the document structure itself.

## Keeping the hot loop lean

The per-character dispatch at the center of the scanner is deliberately
small: few branches, shaped the same way on every call so V8's JIT can keep
it optimized rather than deoptimizing to a slower generic path. Cold paths —
escape-sequence decoding, error message formatting, tag and anchor
resolution, the recursion-depth guard that turns pathological nesting into a
controlled error instead of a stack overflow — are factored out into
separate functions that the hot loop only reaches for on input that actually
needs them. The common case (plain scalars, ordinary indentation, no
escapes) never executes that code at all.

## Next

- [Allocation Strategy](/research/allocation-strategy/) — what happens after
  scanning: how the parsed value is built without fighting V8's own memory
  model.
- [Benchmarks](/benchmarks/) for the throughput this design produces.
