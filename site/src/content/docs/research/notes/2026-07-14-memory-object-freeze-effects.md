---
title: "Object.freeze on parsed output"
optimization:
  name: "Object.freeze on parsed output (memory)"
  conclusion: "Freezing the parsed tree saves no memory, costs ~28% more to build and ~3.9x slower reads, and breaks the mutable-output contract — at most an opt-in for immutability, never a memory optimization."
  verdict: not-worth-it
---
**Verdict: Not worth pursuing** — freezing the parsed tree saves no memory, costs
~28% more to build, makes reads several times slower in current V8, and breaks the
mutable-output contract. At most an opt-in for callers who want immutability for
their own reasons, never a memory optimization.

**Estimated benefit:** **none** for memory (0% heap change), and a net **CPU loss**
on every shape: +28% parse/build time and ~3.9× slower field reads downstream. No
YAML shape or size benefits.

**Rigor:** fail-fast probe (one synthetic record corpus; build cost, read speed
both in-process and re-checked across isolated processes, and the mutability
contract exercised directly).

## Background

`Object.freeze` was on the list of never-evaluated representation ideas. The
hypothesis had two prongs. First, a frozen object's shape can never change, so V8
in principle has more latitude to optimise — the "frozen fast path", including
`PACKED_FROZEN_ELEMENTS` for arrays. Second, freezing might let the engine store an
object more compactly. If either held, an opt-in `freeze: true` could hand callers
faster or smaller parsed data.

Against that: `JSON.parse`, js-yaml, and `yaml` all return **mutable** trees, and
lightning-yaml's own consistency suite deep-equals (and may mutate) parsed values.
Freezing is a visible behaviour change, so it could only ever be opt-in.

## Experiment

From the parsed 5,000-record corpus (same as the value-interning and columnar studies) I measured four things:

1. **Build cost** — warm timing of `parse(text)` versus `deepFreeze(parse(text))`,
   where `deepFreeze` recursively freezes every object and array in the tree.
2. **Heap** — retained size of a mutable parsed tree versus a frozen one.
3. **Downstream read speed** — a tight loop summing a numeric field across all rows,
   mutable versus frozen. Because reading mutable and frozen objects of the same
   shape through one call site pollutes its inline cache (frozen and mutable
   objects carry different hidden classes), I re-ran the read comparison in
   **separate processes**, each with a freshly-compiled, monomorphic read function
   that only ever sees one representation — removing that confound.
4. **Parity** — whether a frozen field can be reassigned and whether a frozen array
   accepts `push`.

Measured under concurrent agent load; **ratios are the robust signal**, absolute
ms/MB are indicative.

## Results

| Aspect | Mutable (today) | Frozen | Effect |
| --- | --- | --- | --- |
| Build (parse [+ freeze]) | 22.4 ms | 28.7 ms | **+28.2%** build cost |
| Retained heap | 3.02 MB | 3.02 MB | **0.0% — no memory benefit** |
| Read a field, in-process | 0.036 ms | 0.160 ms | 4.5× slower (IC-polluted) |
| Read a field, **isolated** | 0.018 ms | 0.069 ms | **3.9× slower** |
| Read/iterate array elements | 0.139 ms | 0.468 ms | 3.4× slower |

Parity (frozen tree):

| Operation | Result |
| --- | --- |
| reassign a frozen field (`row.score = 999`) | silently ignored (would throw in strict mode) |
| `push` onto a frozen array | **throws `TypeError`** |

## Analysis

Every prong of the hypothesis failed, and the read prong failed in the opposite
direction from what was predicted.

**No memory benefit.** Frozen and mutable trees retain identical heap (3.02 MB).
`Object.freeze` sets a flag on the object's hidden class; it does not deduplicate
values, drop slots, or repack anything. For a "compact representation" goal this is
an immediate disqualification — there is simply nothing to gain on the memory axis.

**Reads got slower, not faster.** The naive in-process comparison showed frozen
reads 4.5× slower, which could be dismissed as inline-cache pollution from sharing
one read function across two hidden classes. But the isolated re-run — separate
processes, a fresh monomorphic read function per representation — still shows frozen
**3.9× slower** for field reads and **3.4× slower** for array iteration. So the
slowdown is real, not a measurement artefact. The likely cause is that frozen
arrays adopt V8's `PACKED_FROZEN_ELEMENTS` elements kind, whose element access goes
through a more general (slower) path than the mutable `PACKED_ELEMENTS` fast path
that the engine is most aggressively tuned for. Whatever the exact internal reason,
the "frozen fast path" did not materialise for read-heavy consumer code on this
runtime (Node 22.22 / V8 12.4).

**Build cost is real.** Deep-freezing every container adds a `Object.freeze` call
plus a recursive walk over the whole tree, which shows up as +28% on parse+build.
That is pure overhead with nothing on the other side of the ledger.

**It breaks the contract.** A frozen field assignment is silently dropped (and
would throw under `"use strict"`), and `push` onto a frozen array throws
`TypeError`. `JSON.parse`/js-yaml/`yaml` all hand back mutable data; downstream code
routinely mutates parsed config. Freezing by default would be a breaking behaviour
change with no upside.

## Conclusion & recommendation

**Not worth pursuing** as a memory or performance technique. It saves no memory,
costs CPU at both build and read time, and violates the mutability contract. The
original hypothesis — that frozen objects would be smaller or faster — is refuted on
this runtime.

The only defensible form is an **opt-in `freeze: true`** parse option for callers
who specifically want deep-immutable output for defensive reasons (e.g. sharing a
parsed config across a codebase and wanting accidental mutation to fail loudly). If
it is ever offered, its documentation must be explicit that it is a *correctness/API
convenience, not a performance feature* — it costs ~28% at parse time and makes
downstream reads several times slower, and it must default to `false`. Confidence:
**high** that freeze is a net loss for speed and memory; the results are consistent
and one-directional. Audience: applies to all shapes and sizes — there is no data
profile for which freezing the output pays off.

## Provenance & sources
- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, Linux 6.18.5.
- Deps used: `yaml` 2.9.0 (only to serialize the synthetic corpus). `JSON`/plain mutable `{}[]` is the only comparison baseline.
- Prototype & harness: a scratch freeze microbench over a parsed 5,000-record corpus (build-cost timing, in-process heap-Δ, read-throughput loops) plus an isolated per-process read comparison with a fresh monomorphic read function. `src/` was not modified.
- Measured under concurrent agent load: ratios are durable; absolute ms/MB are machine-specific and indicative.
- Rigor of this study: fail-fast probe.
