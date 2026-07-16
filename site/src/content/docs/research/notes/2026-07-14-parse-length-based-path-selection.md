---
title: "Using string length as a pre-parse heuristic"
optimization:
  name: "Input-length pre-parse gate (parse)"
  conclusion: "Reading `input.length` before parsing is free but the setup it could skip is already tiny, so as a standalone change it buys almost nothing — it earns its keep only as a size-gate for a heavier optimization."
  verdict: not-worth-it
---
**Verdict: Not worth pursuing as a standalone optimization; useful only as a size-gate for future
heavy work.** Reading `input.length` before parsing is essentially free, but the fixed per-call
setup cost it could let us skip is already tiny, so gating it away buys almost nothing. The idea
earns its keep only as a guard that decides whether a *heavier* optimization (runtime codegen, or
possibly value interning) is worth setting up for a given input.

**Estimated benefit:** none as a standalone change (CPU); it is a control mechanism for other
optimizations rather than an optimization in itself.

**Rigor:** analysis of the fail-fast data already gathered in
[`2026-07-14-parse-tiny-document-overhead.md`](./2026-07-14-parse-tiny-document-overhead.md); no separate experiment was run,
because the tiny-document overhead study already measured the exact quantity this idea depends on.


## Background

`String.prototype.length` in V8 is O(1): the length is stored in the string's header, so reading it
does not iterate the characters. That makes it tempting as a "free" signal available before the
parser touches a single byte — we know immediately whether the input is roughly a hundred bytes or
ten megabytes. The proposal is to use that size to pick a parse path up front: for a tiny input,
skip setting up the caching machinery (the key cache, the sibling-key reuse) whose setup cost might
outweigh its benefit; for a large input, enable the heavier machinery, and in future decide whether
an even heavier optimization is worth compiling.

The reasoning is sound in the abstract. Length does not tell you the YAML's *shape*, but it does
bound how much work is coming, and a fixed setup cost matters more, in relative terms, against a
tiny input. The question is purely empirical: is the fixed setup cost the parser actually pays large
enough for a size-gate to reclaim anything worthwhile?

## What we already know (from the tiny-document overhead study)

The tiny-document study measured exactly this. The parser's entire fixed per-call floor — everything
it pays regardless of content — is about **0.39µs above `JSON.parse`** (roughly 0.52µs versus
0.13µs). Of that floor, the one piece a size-gate could plausibly skip for tiny inputs, allocating
the `keyCache` `Map`, is only about **6%**. And the parse-time ratio to `JSON.parse` stays **flat
(~3.0–3.3×) across sizes** from 1 KB to 1 MB, which means there is no disproportionate
tiny-document tax sitting on top of the floor waiting to be removed.

## Interpretation & recommendation

Put those two facts together and the standalone version of the idea does not pay. Skipping the
key-cache setup for small inputs would save roughly 6% of a 0.39µs floor — a few tens of nanoseconds
per parse — and because the ratio is already flat across sizes, there is no hidden small-input
penalty a gate would eliminate. The parser's caches are also already effectively lazy: the key cache
starts empty, and sibling-key reuse only activates once a homogeneous record array appears, so most
of the "setup" a gate would try to avoid is not actually paid on a tiny document in the first place.

Where length genuinely earns its place is one level up, as a cheap **gate on the expensive, optional
optimizations** rather than as an optimization itself. A runtime-compiled serializer (see
[`./2026-07-14-stringify-codegen-speed-ceiling.md`](./2026-07-14-stringify-codegen-speed-ceiling.md)
and the survey) only pays off once enough same-shape records exist to amortize the `new Function`
compile; input length — or, better, an early record count — is exactly the signal that decides
whether to bother. Value interning
([`./2026-07-14-memory-value-interning.md`](./2026-07-14-memory-value-interning.md)) has a similar shape: its Map
probe adds about 16% to parse time, so on a small input where the memory saving is negligible you
would simply not enable it. In both cases length is a control knob that keeps a heavier feature from
firing when it cannot pay for itself.

The recommendation, then, is not to build a length-based fast/slow parse path as a standalone change
— the fixed cost it targets is too small, and too flat across sizes, to justify the extra branch and
the second code path to maintain. The idea should be kept on hand as the natural gating signal for
codegen and interning if and when those are built.

**Confidence:** high that the standalone version is not worth it (it rests directly on the tiny-document overhead study's
measurement); the gating role is a design note rather than a measured result.

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
- Basis: the fixed-floor and per-size ratio measurements in `2026-07-14-parse-tiny-document-overhead.md` (a
  fail-fast probe). No new benchmark was run for this note — it reuses that data.
- `String.prototype.length` being O(1) is a documented V8 property (the length is stored in the
  string header, not recomputed on access).
- Rigor of this study: analysis of existing fail-fast data; no new experiment.
