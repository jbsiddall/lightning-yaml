---
title: "Interning repeated string *values* during parse"
description: "Testing whether interning repeated scalar string values, not just keys, during parse cuts retained heap on repetitive record arrays: it does, at a CPU cost"
optimization:
  name: "String value interning (parse)"
  conclusion: "Deduplicating repeated string values during parse is a real, parity-safe retained-heap reduction on repetitive record arrays, but it costs measurable parse speed, so it belongs behind an opt-in flag."
  verdict: situational
---
**Verdict: Worth pursuing** — a real, parity-safe retained-heap reduction on
repetitive record arrays, but it carries a measurable parse-speed cost, so it
belongs behind an opt-in flag (or a cheaper probe) rather than on by default.

**Estimated benefit:** roughly **−28% retained heap** on repetitive record-array
data (medium/large records with low-cardinality enum/date/tag fields), moving
that shape from ≈1.75× down to ≈1.26× `JSON.parse` retained heap. This is a
**memory** win. It costs **≈+16% parse CPU** on the same shape. Data with mostly
unique string values gets little heap benefit and still pays the CPU.

**Rigor:** fail-fast probe (directional; one prototype, one synthetic corpus,
heap-Δ measured in an isolated process). Not a byte-exact proof.

## Background

lightning-yaml already interns mapping **keys**: `internKey` routes every key through
a per-stream `keyCache: Map<string,string>`, so a thousand records that all spell
`"status"` collapse to one heap string. Scalar **values**, by contrast, are never
interned — every string value is a fresh `src.slice(...)`: the plain-scalar returns in
`resolvePlain`, the double-quoted fast path, and the single-quoted fast path each
allocate a new string.

Record data repeats values heavily: `status`, `category`, `region`, ISO dates,
boolean-ish tokens, and tag words are all drawn from small vocabularies. If the
same value text is materialised once per row, an array of N records holds N copies
of `"active"`. Interning values the same way we intern keys would let all those
rows share one heap string — directly attacking the documented parse-memory gap
(retained heap 2.3–2.7× `JSON` on medium records), which
is the one parse-memory axis with real headroom.

A quick dictionary-mode check ran first, because if the record objects were falling
into V8 "dictionary" (hash-table) mode, the bloat would be object structure, not
strings, and interning would be beside the point. They are not:
`%HasFastProperties` returns `true` for sampled record objects, their `meta`
sub-objects, and the backing array, in both the baseline and the prototype. So the
per-object structure is already compact (shared hidden class); the retained-heap
excess over `JSON` is dominated by the value strings themselves, which is exactly
what interning targets.

## Experiment

I copied `src/index.ts` to a scratch prototype and added a `valueCache:
Map<string,string>` alongside `keyCache`, reset per stream in `resetForStream`, plus
an `internValue(s)` helper (probe the map; on miss, insert and return; skip strings
longer than 64 chars so genuinely-unique long text does not fill the map). I wrapped
the four string-value return sites listed above in `internValue(...)`. Keys were left
exactly as-is. Output therefore stays a plain `{}`/`[]` tree of ordinary strings.

The corpus is a 5,000-element array of API/log-shaped records (≈1.3 MB YAML,
≈1.28 MB JSON) mirroring the bench `makeRecord`, with the low-cardinality fields
the brief calls out added explicitly: `status` (5 values), `category` (8),
`region` (5), `created` (a bounded date range), and `tags`/`name` drawn from a
20-word vocabulary, alongside a high-cardinality `uuid` and a mostly-unique
`score`. Across the whole corpus there are 42,405 string values but only 8,928
distinct ones — a **4.75× average repetition** that mirrors real record data.

Heap was measured in an isolated process modeled on `bench/memory/worker.ts`:
settle a GC baseline with the input string already resident, parse 25 times keeping
only the last result reachable, GC again, and report the retained delta (the size
of one parsed tree). Parse speed was measured in the same process family with a
warm (post-TurboFan) timing loop, interleaving baseline/prototype/`JSON.parse`
across three rounds and taking the minimum of each to suppress scheduler noise.
Parity was checked with `assert.deepStrictEqual` against the `JSON.parse` value and
a `JSON.stringify` round-trip equality.

Measured under concurrent load from sibling agents; **ratios and heap-Δ are the
robust signals, absolute ms are indicative**.

## Results

Retained heap for one parsed 5,000-record tree (two runs, stable):

| Parser | Retained heap | Ratio vs `JSON.parse` |
| --- | --- | --- |
| `JSON.parse` | 1.82 MB | 1.00× |
| lightning-yaml baseline | 3.19–3.21 MB | **1.75×** |
| lightning-yaml + value interning | 2.28–2.30 MB | **1.26×** |

That is a **−28% reduction in retained heap** for the prototype versus the
baseline, closing most of the gap to `JSON`. The absolute saving (≈0.92 MB) matches
the mechanism almost exactly: eliminating 42,405 − 8,928 ≈ 33,477 duplicate short
strings at ~28 bytes each (V8 flattens sub-13-char slices into fresh sequential
strings, so today's duplicates are independent allocations, not shared slices)
predicts ≈0.94 MB — so the win is genuinely duplicate-string elimination, not a
measurement artefact. Note the prototype's retained figure still *includes* the
`valueCache` map left live after the final parse, so a production version that
released it after parse could retain slightly less.

Parse speed (warm loop, minimum of interleaved rounds):

| Parser | ms / parse | Ratio vs `JSON.parse` |
| --- | --- | --- |
| `JSON.parse` | 6.88 | 1.00× |
| lightning-yaml baseline | 22.65 | 3.29× |
| lightning-yaml + value interning | 26.25 | 3.82× |

The interning prototype is **1.16× the baseline's parse time (+16%)**.

Parity: `deepStrictEqual` against the `JSON.parse` value **passed** for both the
baseline and the interning prototype, and the `JSON.stringify` round-trip was
byte-identical for both. Interning returns a `===`-equal string, so it is invisible
to every downstream consumer — **parity-safe**.

## Interpretation & recommendation

The idea works, and for the right reason. On repetitive record data, value strings
are the bulk of lightning-yaml's retained-heap excess over `JSON`, and collapsing
duplicates to one shared heap string recovers most of it — 1.75× → 1.26× `JSON`
retained — with zero observable behaviour change. This is the parity-safe variant
the brief predicted, and it is the most promising lever for the one parse-memory
gap that still has headroom.

The cost is the catch. A `Map` probe on **every** string value — including the
high-cardinality `uuid`/`name` fields that rarely dedup — adds ~16% to parse time,
which is more than the "small/neutral" cost hoped for. That is too much to switch on
unconditionally in a library whose headline is *approaching `JSON.parse` speed*: a
16% speed regression to gain memory is the wrong default trade for the median user,
who is CPU-bound, not memory-bound.

So the recommendation is **Worth pursuing, but not as an always-on default**:

1. **Opt-in `internValues: true` parse option** (confidence: high). Users parsing
   large, repetitive record arrays into long-lived memory (config blobs, seed data,
   in-memory caches) opt in and take the −28% heap; everyone else keeps today's
   speed. Wiring: add `valueCache` next to `keyCache`, reset it in `resetForStream`,
   and gate the `internValue` wrapper at the four sites (`resolvePlain`,
   `parseDoubleQuoted`, `parseSingleQuoted`) on the option.
2. **Cheaper probe, possibly default-able** (confidence: medium; needs a deeper
   follow-up). The 16% is dominated by hashing every value. A FastValueMatch analog
   to the existing key path (`lastRecordKeys`) — compare the upcoming value bytes
   against the previous sibling row's value at the same field before hashing — could
   skip the map for runs of identical values, and interning
   only *plain* scalars (skipping quoted free-text) would cut probe count on the
   fields least likely to dedup. If a follow-up gets the penalty into the low single
   digits, on-by-default becomes plausible.

Audience and confidence: the benefit lands squarely on **repetitive record arrays,
medium size and up** (the owner's stated common case), with **high confidence** in
the ≈−28% heap figure and the parity-safety, and **medium confidence** that the
speed cost can be reduced enough to make it a default. Unique-value data (dense
free-text, high-cardinality identifiers) sees little heap benefit and should not pay
the CPU — another reason to keep it opt-in or heuristic rather than blanket.

## Code references

- `internKey` — `src/index.ts:1782`
- `keyCache` — `src/index.ts:282`
- `resolvePlain` — `src/index.ts:2023` (second return at `:2085`)
- `parseDoubleQuoted` — `src/index.ts:2443`
- `parseSingleQuoted` — `src/index.ts:2628`
- `resetForStream` — `src/index.ts:475`
- `lastRecordKeys` — `src/index.ts:302`

## Provenance & sources
- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, Linux 6.18.5.
- Deps used: `yaml` 2.9.0 (only to serialize the synthetic corpus to block YAML). `JSON` is the only comparison baseline.
- Prototype & harness: scratch copies of `src/index.ts` (baseline vs. value-interning), a synthetic 5,000-record corpus, an isolated heap-Δ worker (modeled on `bench/memory/worker.ts`), and a warm interleaved speed loop. `src/` was not modified.
- Measured under concurrent agent load: ratios / heap-Δ are the durable signals; absolute ms are machine-specific and indicative.
- Rigor of this study: fail-fast probe.
