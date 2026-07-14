# Hand-rolling number conversion in the parse path

**Verdict: Not worth pursuing** — number conversion is a large, real slice of parse
CPU (~18% of self-time), but it is already sitting on V8's native floor; a
hand-written JavaScript float parser is *slower* and loses precision.
**Estimated benefit:** none (negative result). The lever we hoped for — replacing
`+src.slice()` on the float path with a manual mantissa/exponent accumulator — costs
CPU rather than saving it, on any records-shaped YAML that carries floats.
**Rigor:** fail-fast probe (one CPU profile plus one isolated conversion
micro-benchmark; directional, not a proof).

## Background

The dossier flags value materialization — and number conversion specifically — as the
dominant term in the residual ~2× gap between our `parse` and built-in `JSON.parse`,
with raw character scanning only ~8%. The parser's number path lives in `tryNumber`
(`src/index.ts:2254`), reached from `resolvePlain` (`src/index.ts:2016`) whenever a
plain scalar begins with a digit, sign, or dot. Two paths exist inside it:

- **Integers up to 15 digits** accumulate as a V8 small-integer (Smi) with the loop
  `v = v * 10 + d` and return `neg ? -v : v` (`src/index.ts:2322`). No substring is
  allocated and no string→number coercion happens — this is already optimal.
- **Floats, and integers longer than 15 digits**, fall through to
  `+src.slice(start, end)` (`src/index.ts:2323`): allocate the substring, then coerce
  it to a double with unary `+`.

The hypothesis was that the float branch is expensive on two counts — the slice
allocation and the string→double conversion — and that a hand-rolled accumulator
reading digits straight out of the source (mantissa as an integer, then divide by a
power of ten, with a separate exponent) could skip both and shave a chunk off that
13-14% `tryNumber` cost. The records fixtures are a fair test: every record carries two
integers (`id`, `views` — the Smi path) and two floats (`score`, e.g. `66.7285`, and
`ratio`, e.g. `0.28274658997543156` at ~17 significant figures — the slice path).

## Experiment

Two measurements, both on this session's machine while other agents ran concurrently
(so absolute ms are indicative; the profile-% and the conversion *ratios* are the
robust signals):

1. **CPU self-time attribution.** Using the V8 inspector `Profiler` at a 50 µs sampling
   interval, profile a warm loop of `parse()` over `yaml-plain-medium-records.yaml`
   (400 iterations) and `yaml-plain-large-records.yaml` (60 iterations), summing each
   function's `hitCount` (top-of-stack samples = self-time) by name.
2. **Conversion headroom micro-benchmark.** Extract every float-shaped slice from the
   medium fixture (991 of them), and time four strategies converting them in a tight
   loop (4000 repetitions): the parser's unary `+string`; `Number(string)`;
   `parseFloat(string)`; and a hand-rolled `manualFloat` accumulator. The strings are
   pre-sliced so the loop isolates the *conversion*, which is the part we hoped to
   improve; the manual path additionally would have saved the slice, so this comparison
   is generous to it. Every result is also checked for bit-identical agreement with
   `+string`.

## Results

Parse self-time, top leaf functions (share of all samples):

| Function                  | medium-records | large-records |
| ------------------------- | -------------: | ------------: |
| `parseBlockNode`          |          24.2% |         21.7% |
| `parseBlockMap`           |          21.7% |         22.7% |
| `tryNumber`               |      **13.8%** |     **13.2%** |
| `resolvePlain`            |           5.0% |          4.3% |
| **whole number path**     |      **18.8%** |     **17.5%** |

(The number path = `tryNumber` + `resolvePlain` + `numberBoundary` + the hex/octal
helpers; `numberBoundary` is mostly inlined and never sampled above noise.)

Float-conversion micro-benchmark, 991 slices × 4000 reps, expressed as a ratio to the
parser's current `+string` (lower is faster):

| Strategy       | ratio to `+string` | bit-identical to `+`? |
| -------------- | -----------------: | --------------------- |
| `+string`      |          1.00× (baseline) | —              |
| `Number()`     |              0.96× | yes                   |
| `parseFloat()` |              0.90× | yes on these inputs, but semantically lenient |
| `manualFloat`  |          **1.16×** | **no — 448 / 991 differ** |

## Interpretation & recommendation

The profile confirms the dossier: number conversion is genuinely one of the largest
single costs in the parse hot path — `tryNumber` is the third-heaviest function behind
only the two block-structure dispatchers, and the number path as a whole is roughly a
fifth of all parse self-time. So the *target* was well chosen. The problem is that the
target has no give.

The micro-benchmark shows why. V8's string→double conversion (`+string` / `Number()`)
routes into a heavily optimized native `StringToDouble`, and nothing we can write in
JavaScript beats it: the hand-rolled accumulator is **16% slower**, not faster. It is
also *wrong* — on 448 of 991 real values it disagrees with `+string`, because a
17-significant-figure `ratio` overflows the 2^53 exact-integer range of the mantissa
accumulator and the `divide by 10^frac` step is not correctly rounded the way
`StringToDouble` is. `parseFloat` is the only strategy that is actually faster (10%),
but it is both semantically unsafe for us (it silently accepts trailing junk that our
grammar must reject) and only a marginal win on the *conversion*, which is a fraction of
the already-small float branch.

It is worth being clear about where the slice sits in all this. `src.slice(start, end)`
on a substring of the one big source string produces a V8 *SlicedString* — a pointer,
offset, and length, with no character copy — so the allocation the manual path would
have avoided is close to free, which is the other half of why avoiding it buys nothing.

For scale against the reference point the whole project measures itself by: our `parse`
runs at roughly 2× the time of built-in `JSON.parse` on these records fixtures.
JSON.parse does its number conversion in the same native C++ we already call. So the
number path is not where our 2× lives — we are already paying native conversion cost for
it, and the ~18% it occupies is essentially irreducible without changing the output
representation (which the parity mandate forbids). The recommendation is to spend no
further effort trying to make number conversion faster in JavaScript, and to look for
the residual 2× in the block-structure dispatch and string-scalar resolution instead —
`parseBlockNode` + `parseBlockMap` together are ~45% of self-time, and on the large
fixture `resolveBlockPlain` alone climbs to ~15%. Confidence: **high** that the
number-conversion lever is dead (the negative is large and consistent across both
fixtures and all four conversion strategies); the audience for that conclusion is any
numeric-heavy records YAML.

## Provenance & sources

- Repo: lightning-yaml @ f9ffcad (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, Linux 6.18.5.
- Fixtures: bench/fixtures/data/{yaml-plain-medium-records.yaml, yaml-plain-large-records.yaml, medium-records.json} (gitignored, reproducible via `pnpm gen:fixtures`).
- Measured under concurrent load from sibling agents; ratios and profile-% are the robust signals, absolute ms indicative.
- Probe scripts in session scratch (`parse-probe/num.ts`): inspector `Profiler` self-time + 4-way float-conversion micro-benchmark.
- Rigor of this study: fail-fast probe.
