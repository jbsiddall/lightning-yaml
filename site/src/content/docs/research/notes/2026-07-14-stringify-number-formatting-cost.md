---
title: "Hand-optimizing formatNumber in stringify"
optimization:
  name: "Hand-rolled formatNumber (stringify)"
  conclusion: "`formatNumber` looks costly in profiles but is near-irreducible — `String(v)` is already V8's optimal shortest round-trip and the best fast-path saves under 1% of dump time."
  verdict: not-worth-it
---
**Verdict: Not worth pursuing** — `formatNumber` looks expensive in the CPU profile, but
its cost is almost entirely irreducible: `String(v)` is already V8's optimal
shortest-round-trip formatter, and the best fast-path we could add saves under 1% of total
dump time.

**Estimated benefit:** none of consequence (negative result). A bare `String(v)` path is
~3% faster than the current guarded formatter *in isolation*, and an integer fast-path
~7% *in isolation*; against the whole dumper both are below 1% of total CPU. No memory
effect.

**Rigor:** thorough enough to settle it — an isolation microbenchmark of the formatter
against its candidate replacements, read against the function's measured share of a full
dump profile.

whole set.*

## Background

Number formatting shows up prominently in the dumper's CPU profile. `formatNumber`
accounts for 8–12% of non-idle self-time across the fixtures:

| function | large-records | large-nested | xlarge-records |
| --- | ---: | ---: | ---: |
| `formatNumber` | 12.1 | 8.7 | 8.1 |

A number that large invites the assumption that the formatter is doing wasteful work.
`formatNumber` is guarded — it handles the special cases YAML requires (for example
infinities and the sign of values) before falling back to the default string conversion —
so a natural hypothesis is that stripping those guards down to a bare `String(v)`, or
adding a dedicated integer fast-path, would reclaim a meaningful slice of that 8–12%.

## Experiment

We benchmarked the formatter in isolation against two candidate replacements: a bare
`String(v)` with no guards, and a branch that detects integers and formats them on a
dedicated fast-path before deferring to the general case for everything else. The point of
the isolation test was to establish the *ceiling* — the most either replacement could
possibly save if it were free everywhere else — and then to weigh that ceiling against
`formatNumber`'s measured share of a full dump, since a function that is 10% of a profile
can contribute at most 10% even if it were made instantaneous.

## Results

In isolation, bare `String(v)` is only about **3% faster** than the current guarded
`formatNumber`, and the integer fast-path about **7% faster**. Those are the ceilings for
the formatter alone. Weighted by `formatNumber`'s ~8–12% share of total dump CPU, a 3–7%
speedup of the function translates to **under 1% of total** dump time. There is no memory
dimension to this change; formatting a number does not alter the output bytes or retained
heap.

## Interpretation & recommendation

The profile share is misleading taken on its own. `formatNumber` is a hot function because
the dumper formats a great many numbers, not because each call is wasteful. The isolation
numbers show there is very little slack inside it: `String(v)` is V8's optimal
shortest-round-trip conversion — the engine's own float-to-string is hard to beat from
JavaScript — and even a specialised integer branch only claws back a few percent of a
function that is itself a small fraction of the whole. Multiplying a ~3–7% local win by a
~10% share leaves a sub-1% total, which is below the run-to-run noise floor of the harness
and not worth the added branch and maintenance surface.

Recommendation: leave `formatNumber` as it is. The lever to pull for dump CPU is not
number formatting; it is the key-quote cache
([`./2026-07-14-stringify-speedup-via-key-caching.md`](./2026-07-14-stringify-speedup-via-key-caching.md)) and the
single-pass write
([`./2026-07-14-stringify-speedup-via-single-pass-dumping.md`](./2026-07-14-stringify-speedup-via-single-pass-dumping.md)), which
together move the needle by tens of percent rather than fractions of one.

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off
  main), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan), pnpm 10.33.0,
  build target ES2022 (tsup 8.5.1). Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
  All ms/ratios are from this machine.
- Bench: bespoke node scripts (mitata not used here); an isolation microbenchmark of the
  formatter, read against a full-dump CPU profile (`node --cpu-prof --cpu-prof-interval
  150–200 --import tsx`, self-time as a percentage of non-idle samples).
- Fixtures: bench/fixtures/data/ (gitignored, reproducible via `pnpm gen:fixtures`).
- Ratios are the durable signal; absolute ms are machine-specific.
- Rigor of this study: thorough enough to settle it; negative result.
