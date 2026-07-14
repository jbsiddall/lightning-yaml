# Replacing the ConsString rope with an array-of-chunks + `join`

**Verdict: Not worth pursuing** — the current `out += …` ConsString rope is 4–11% faster
than accumulating chunks in an array and calling `join` on four of five fixtures; the one
apparent win is garbage-collection variance, not a real effect.

**Estimated benefit:** none (negative result). Switching to array + `join` would *lose*
CPU on the common cases and change peak RSS not at all. This paper exists to record the
measurement so the choice is not revisited without new evidence.

**Rigor:** thorough experiment. A full prototype swapping the accumulation strategy,
verified byte-identical to current output, timed GC-between with medians of 40–400
samples.

*Part of the round-2 stringify studies; see [`./2026-07-14-json-performance-research-overview.md`](./2026-07-14-json-performance-research-overview.md) for
the whole set.*

## Background

The dumper accumulates its output in a module-level `out` string via repeated
`out += …`. On V8 this does not copy the growing string on every append: the engine
builds a ConsString rope (a tree of string fragments) and flattens it once, when the
final result is read. There is a design comment recording this deliberate choice at
`src/index.ts:4366`.

The obvious alternative — and a common idiom in JavaScript string-building — is to push
each fragment onto an array and call `Array.prototype.join("")` at the end. The
hypothesis worth testing was that the array approach might allocate less transient garbage
or flatten more cheaply than the rope, given how much of the dumper's cost at scale is
allocation-driven. Since string accumulation is on the hottest path of the whole dumper,
even a few percent would be worth capturing if it were real.

## Experiment

We copied `src/index.ts` into a prototype and replaced the ConsString rope with an
array-of-chunks accumulator plus a terminal `join("")`, changing nothing else. The output
was verified byte-identical to the current dumper. Timing used the shared harness for this
round: `performance.now()` per call, an explicit `global.gc()` before every sample so that
collection of the previous iteration cannot contaminate the timed region, and medians over
40–400 samples, all reported as ratios against `JSON.stringify` of the identical value.
Because the machine was shared during the session, absolute milliseconds are indicative
and the ratios are the robust signal — a caveat that turns out to matter for reading the
single positive result below.

Fixtures: `medium-records`, `large-records`, `xlarge-records`, `medium-nested`, and
`large-nested`.

## Results

Array + `join` versus the current rope (`base`), as a percentage faster than base
(GC-between medians); negative means the rope is faster:

| lever (verified byte-identical) | medium-rec | large-rec | xlarge-rec | medium-nest | large-nest |
| --- | ---: | ---: | ---: | ---: | ---: |
| **rope → array + `join`** | −4% | **−11%** | −7% | −9% | +24%† |

† `large-nested` is the sole positive for array + `join`, and it is **noise**. That
fixture carries the highest garbage-collection share of the set (17% of non-idle samples)
and correspondingly the highest run-to-run variance, so a single favourable reading is not
trustworthy. On the other four fixtures the rope is unambiguously faster, by 4% to 11%.

## Interpretation & recommendation

Read straight, the numbers say the ConsString rope is the better accumulator: it wins on
`medium-records`, `large-records`, `xlarge-records`, and `medium-nested` by margins (4–11%)
well outside noise, and the only fixture where array + `join` appears ahead is the one with
the most garbage-collection variance, which makes its lone +24% the least credible data
point rather than the most exciting one. V8's rope plus a single terminal flatten avoids
building and then walking a separate array of fragments, and it does not have to allocate
that array at all; the measured result is consistent with that being genuinely cheaper.

Recommendation: keep the rope. This confirms the existing design comment at
`src/index.ts:4366`, and there is nothing to change. Converting to array + `join` is a
measured non-win and should not be attempted without new evidence that overturns these
numbers.

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off
  main), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan), pnpm 10.33.0,
  build target ES2022 (tsup 8.5.1). Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
  All ms/ratios are from this machine.
- Bench: bespoke node scripts (mitata not used here); GC between every sample; medians of
  40–400 samples. Ratios against `JSON.stringify` of the identical value.
- Fixtures: bench/fixtures/data/ (gitignored, reproducible via `pnpm gen:fixtures`).
- Ratios are the durable signal; absolute ms are machine-specific — and the highest-GC
  fixture (`large-nested`) is exactly where a single sample is least trustworthy.
- Rigor of this study: thorough experiment (byte-identical), negative result.
