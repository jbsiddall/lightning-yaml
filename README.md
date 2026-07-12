# lightning-yaml

A fast YAML parser — currently the **benchmark + correctness harness** that
establishes the baseline we aim to beat: how `JSON.parse`/`JSON.stringify`
compare against the two leading JS YAML libraries (`yaml` and `js-yaml`) on
**speed** and **peak memory**, plus a consistency suite that will hold our parser
to the spec.

The parser itself is still a stub: [`src/index.ts`](src/index.ts) exports
`parse`/`stringify` that throw `NotImplementedError`. Everything around it — the
benchmarks and the [vitest](https://vitest.dev) consistency tests — is already
wired to that stub, so building the real parser is a matter of making red tests
green and watching the benchmark numbers move. This is the measuring stick.

## Approach

- **Test data spans three categories** (all generated deterministically from a
  seeded PRNG, across a matrix of sizes and shapes):
  - **JSON** — JSON is a subset of YAML 1.2, so the exact same bytes feed
    `JSON.parse` and both YAML parsers (~1 KB → ~10 MB). A clean apples-to-apples
    comparison.
  - **YAML, plain** — the same JSON-shaped data emitted as *block* YAML, with no
    tags or anchors: "just JSON structures, in YAML syntax". `JSON.parse` can't
    read block YAML, so it's dropped from parsing these (but stays as a stringify
    baseline — the value is still JSON-compatible).
  - **YAML, rich** — block YAML that uses YAML-only syntax: the `!!binary` tag
    (base64 blobs) and `&anchor`/`*alias` graph references (shared object
    references). JSON can neither read the text nor represent the value, so it's
    dropped from these entirely.

  Which candidates run for which (category, op) is decided by `candidateApplies`
  in [`bench/candidates.ts`](bench/candidates.ts).
- **Speed → [mitata](https://github.com/evanwashere/mitata), run sequentially.**
  mitata JIT-compiles a batched measurement loop (4096 iters between timestamps)
  and has a `do_not_optimize` guard, so it stays accurate down to sub-microsecond
  ops like `JSON.parse` — where Vitest/tinybench (one timestamp per call, no
  anti-DCE guard) loses resolution. Benchmarks run **one at a time**: parallel
  micro-timing is corrupted by CPU frequency scaling, cache/port contention, and
  shared stop-the-world GC.
- **Peak memory → isolated child processes, run sequentially.** See below.

## Why a separate memory harness

mitata reports a memory column, but it is **not** what we need. mitata measures
the **per-iteration V8 heap-allocation delta** (`v8.getHeapStatistics()`) — it
never touches OS resident memory (a grep of the package for `resourceUsage`/
`maxRSS`/`rss` finds nothing). That number **excludes native/off-heap memory**
(string backing stores, `ArrayBuffer`s, native-addon allocations), which for a
parser can dominate.

Our harness instead spawns one isolated process per candidate and reads
**`process.resourceUsage().maxRSS`** — the whole-process peak resident set (heap
+ native + external). The gap is not academic. Parsing the 10 MB fixture:

| candidate | **peak RSS** (our harness) | heap Δ (what mitata sees) |
| --------- | -------------------------- | ------------------------- |
| JSON      | 282 MB                     | 17.4 MB                   |
| js-yaml   | 495 MB                     | 38 MB                     |
| **yaml**  | **2.63 GB**                | **39.8 MB**               |

mitata would report `yaml` at ~40 MB and **miss the 2.63 GB reality** — a 66×
blind spot of exactly the native/off-heap memory a YAML parser burns. So the two
tools are complementary: mitata for speed + per-call heap churn, our harness for
true peak RSS.

Each candidate runs in its **own OS process** (the correct isolation for a clean
peak), and workers run **one at a time**. We deliberately do *not* run them
concurrently: co-running the heavy parses (that 2.63 GB `yaml` job) can push the
machine into swapping, which corrupts RSS in ways that are hard to account for.
Sequential keeps every number trustworthy.

Iterations are fixed (`BENCH_ITERS`, default 25) and **should stay fixed**: peak
RSS is a sustained-allocation high-water mark that grows with iteration count
(e.g. `yaml` on the 1 MB fixture reports ~520 MB at 25 iterations but only
~308 MB at 5), so changing it shifts the peak-RSS numbers. `heap Δ` is
iteration-independent.

## Candidates

Grouped in [`bench/candidates.ts`](bench/candidates.ts) — a single registry
reused by every benchmark:

| name           | group       | kind | parse                   | stringify               |
| -------------- | ----------- | ---- | ----------------------- | ----------------------- |
| JSON           | baseline    | json | `JSON.parse`            | `JSON.stringify`        |
| js-yaml        | competition | yaml | `load`                  | `dump`                  |
| yaml           | competition | yaml | `parse`                 | `stringify`             |
| lightning-yaml | ours        | yaml | `src/index.ts` _(stub)_ | `src/index.ts` _(stub)_ |

`lightning-yaml` is **already registered** (group `ours`), wired to
[`src/index.ts`](src/index.ts). Its `parse`/`stringify` throw
`NotImplementedError` for now, so the benchmarks skip it (mitata can't time a
throwing function) and the consistency tests fail against it — implementing
`src/index.ts` lights both up automatically, no registry changes needed. Each
candidate's `kind` (`json` vs. `yaml`) decides which data categories it runs on.

## Correctness — the consistency suite

Speed is meaningless if the output is wrong, so before the parser is trusted it
has to agree with a reference. We deliberately pick **one** oracle rather than
cross-checking every library against every other (they legitimately disagree —
js-yaml targets YAML 1.1, `yaml` targets 1.2): [`bench/oracle.ts`](bench/oracle.ts)
designates **`yaml`** — the most spec-compliant JS parser — as ground truth. It's
the only competitor we compare ourselves against for correctness. The oracle
normalizes `!!binary` to a portable plain `Uint8Array` (the library defaults to a
Node `Buffer`, which wouldn't deep-equal a spec-portable `Uint8Array`) and reads
with `maxAliasCount: -1` for the anchor-heavy rich fixtures.

`pnpm test` runs a [vitest](https://vitest.dev) suite over the same fixture data
the benchmarks use (up to 1 MB — the 10 MB `xlarge` case is skipped, too heavy
for an in-process oracle round-trip):

- **[`test/consistency.test.ts`](test/consistency.test.ts)** — for every fixture,
  `lightning-yaml.parse(text)` must deep-equal `oracle.parse(text)`, and
  `oracle.parse(lightning-yaml.stringify(value))` must deep-equal `value` (a
  round-trip *through the oracle*, since two YAML writers can emit
  different-but-equivalent text). Rich fixtures additionally assert that
  `&anchor`/`*alias` reuse is reconstructed as **shared references**, not deep
  copies. **Every one of these fails today** — the stub throws — and that is the
  point: each red test is a concrete spec the real parser must satisfy.
- **[`test/fixtures.test.ts`](test/fixtures.test.ts)** — sanity checks on the
  fixtures and oracle themselves: they parse deterministically, JSON-compatible
  data round-trips, rich fixtures really do contain `!!binary`/anchors and plain
  ones don't. These **pass**, so a red consistency test unambiguously means "ours
  is wrong", not "the harness is broken".

The suite is not a benchmark and doesn't measure anything; it's the correctness
gate that makes the benchmark numbers meaningful once the parser exists.

## Usage

```bash
pnpm install
pnpm gen:fixtures       # generate bench/fixtures/data/* — JSON + YAML (gitignored, reproducible)

pnpm test               # vitest consistency suite (ours vs. the yaml oracle) — red until implemented

# low-level runners (all candidates by default; BENCH_SCOPE=competition|ours to filter)
pnpm bench:speed        # mitata parse + stringify throughput
pnpm bench:memory       # peak RSS + retained heap per candidate (sequential)

# report generators — refresh the README results blocks
pnpm bench:self         # our implementation only (fast) — run before every commit/PR
pnpm bench:competition  # JSON + js-yaml + yaml, full matrix (slow) — run on dep/dataset changes
pnpm bench              # gen:fixtures + competition + self

pnpm typecheck
```

The two report scripts refresh two different README blocks on two different
cadences — see [CLAUDE.md](CLAUDE.md):

- **`bench:self`** benchmarks only this repo's parser (+ JSON baseline) and is
  fast; run it before every commit. There's no parser yet, so today it just
  writes a caveat.
- **`bench:competition`** benchmarks the competition across the full matrix and
  is slow (xlarge/yaml); only re-run it when dependency versions or datasets
  change.

## Benchmark results

> Representative snapshots on the maintainer's machine. Numbers drift run-to-run;
> peak-RSS / heap-Δ are the stable figures. Regenerate with the commands above.

### Competition

<!-- BENCH:COMPETITION:START -->
_Generated by `pnpm bench:competition`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~2.10 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.80GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  5.36 µs/iter` | `  5.22 µs` | `  5.41 µs` | `  5.50 µs` | `  5.51 µs` |
| js-yaml | ` 39.34 µs/iter` | ` 33.31 µs` | ` 37.17 µs` | ` 85.21 µs` | `474.18 µs` |
| yaml    | `595.14 µs/iter` | `446.02 µs` | `586.08 µs` | `  1.47 ms` | `  1.76 ms` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `621.98 µs/iter` | `539.11 µs` | `633.36 µs` | `  1.02 ms` | `  1.45 ms` |
| js-yaml | `  4.55 ms/iter` | `  4.04 ms` | `  4.85 ms` | `  6.41 ms` | `  6.47 ms` |
| yaml    | ` 73.09 ms/iter` | ` 62.56 ms` | ` 72.69 ms` | ` 96.52 ms` | ` 97.21 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  7.12 ms/iter` | `  6.56 ms` | `  7.03 ms` | `  9.13 ms` | `  9.25 ms` |
| js-yaml | ` 50.66 ms/iter` | ` 49.14 ms` | ` 50.00 ms` | ` 52.55 ms` | ` 56.27 ms` |
| yaml    | `723.32 ms/iter` | `673.21 ms` | `750.73 ms` | `766.42 ms` | `813.55 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | ` 80.19 ms/iter` | ` 75.01 ms` | ` 78.49 ms` | ` 87.20 ms` | `111.27 ms` |
| js-yaml | `467.07 ms/iter` | `437.41 ms` | `480.40 ms` | `490.03 ms` | `490.70 ms` |
| yaml    | `   7.03 s/iter` | `   6.22 s` | `   7.37 s` | `   7.92 s` | `   9.24 s` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  1.24 ms/iter` | `  1.14 ms` | `  1.23 ms` | `  2.03 ms` | `  2.45 ms` |
| js-yaml | `  7.75 ms/iter` | `  6.90 ms` | `  8.03 ms` | ` 10.11 ms` | ` 10.20 ms` |
| yaml    | ` 92.58 ms/iter` | ` 87.39 ms` | ` 91.84 ms` | ` 94.33 ms` | `114.95 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  8.77 ms/iter` | `  8.47 ms` | `  8.69 ms` | ` 10.50 ms` | ` 10.58 ms` |
| js-yaml | ` 53.98 ms/iter` | ` 51.57 ms` | ` 54.12 ms` | ` 58.17 ms` | ` 58.92 ms` |
| yaml    | `675.53 ms/iter` | `646.45 ms` | `677.13 ms` | `724.20 ms` | `739.52 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 54.96 µs/iter` | ` 47.37 µs` | ` 52.86 µs` | `123.73 µs` | `574.52 µs` |
| yaml    | `596.76 µs/iter` | `474.28 µs` | `607.27 µs` | `  1.21 ms` | `  2.11 ms` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  6.76 ms/iter` | `  6.41 ms` | `  6.85 ms` | `  8.41 ms` | `  9.30 ms` |
| yaml    | ` 76.63 ms/iter` | ` 70.49 ms` | ` 76.36 ms` | ` 85.12 ms` | ` 97.18 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 69.42 ms/iter` | ` 66.44 ms` | ` 69.32 ms` | ` 70.49 ms` | ` 83.65 ms` |
| yaml    | `759.94 ms/iter` | `727.34 ms` | `774.98 ms` | `794.07 ms` | `827.32 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  2.73 ms/iter` | `  2.58 ms` | `  2.73 ms` | `  3.33 ms` | `  3.47 ms` |
| yaml    | ` 31.82 ms/iter` | ` 30.16 ms` | ` 32.59 ms` | ` 33.49 ms` | ` 36.21 ms` |

| • parse · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 73.04 µs/iter` | ` 60.49 µs` | ` 73.31 µs` | `179.29 µs` | `606.79 µs` |
| yaml    | `909.48 µs/iter` | `672.41 µs` | `890.83 µs` | `  1.93 ms` | `  2.93 ms` |

| • parse · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  6.10 ms/iter` | `  5.57 ms` | `  6.40 ms` | `  7.38 ms` | `  7.64 ms` |
| yaml    | ` 64.95 ms/iter` | ` 56.67 ms` | ` 66.80 ms` | ` 74.43 ms` | ` 98.95 ms` |

| • parse · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 59.24 ms/iter` | ` 56.34 ms` | ` 58.89 ms` | ` 63.93 ms` | ` 68.62 ms` |
| yaml    | `739.30 ms/iter` | `708.64 ms` | `744.24 ms` | `759.85 ms` | `761.08 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  3.74 µs/iter` | `  3.62 µs` | `  3.79 µs` | `  3.87 µs` | `  3.91 µs` |
| js-yaml | ` 66.57 µs/iter` | ` 51.59 µs` | ` 63.55 µs` | `168.16 µs` | `815.59 µs` |
| yaml    | `297.01 µs/iter` | `227.06 µs` | `296.39 µs` | `  1.21 ms` | `  1.84 ms` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `416.85 µs/iter` | `383.53 µs` | `424.02 µs` | `582.52 µs` | `858.09 µs` |
| js-yaml | `  7.06 ms/iter` | `  6.70 ms` | `  7.25 ms` | `  7.85 ms` | `  8.05 ms` |
| yaml    | ` 30.27 ms/iter` | ` 28.84 ms` | ` 30.35 ms` | ` 33.52 ms` | ` 35.66 ms` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  5.43 ms/iter` | `  5.14 ms` | `  5.36 ms` | `  7.87 ms` | `  8.06 ms` |
| js-yaml | `142.33 ms/iter` | `133.95 ms` | `147.99 ms` | `152.10 ms` | `152.74 ms` |
| yaml    | `336.85 ms/iter` | `321.96 ms` | `346.68 ms` | `347.65 ms` | `351.86 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | ` 60.92 ms/iter` | ` 59.77 ms` | ` 61.35 ms` | ` 62.59 ms` | ` 63.02 ms` |
| js-yaml | `   4.97 s/iter` | `   4.89 s` | `   4.98 s` | `   5.04 s` | `   5.09 s` |
| yaml    | `   3.31 s/iter` | `   3.22 s` | `   3.34 s` | `   3.38 s` | `   3.38 s` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `839.21 µs/iter` | `723.42 µs` | `822.48 µs` | `  1.17 ms` | `  5.16 ms` |
| js-yaml | ` 13.07 ms/iter` | ` 12.32 ms` | ` 13.30 ms` | ` 14.19 ms` | ` 14.27 ms` |
| yaml    | ` 52.28 ms/iter` | ` 50.00 ms` | ` 51.40 ms` | ` 53.53 ms` | ` 63.33 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  6.04 ms/iter` | `  5.65 ms` | `  5.97 ms` | `  9.10 ms` | `  9.27 ms` |
| js-yaml | `177.25 ms/iter` | `173.77 ms` | `178.02 ms` | `181.36 ms` | `184.22 ms` |
| yaml    | `363.25 ms/iter` | `351.69 ms` | `368.54 ms` | `370.35 ms` | `392.69 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  3.02 µs/iter` | `  2.91 µs` | `  3.08 µs` | `  3.25 µs` | `  3.26 µs` |
| js-yaml | ` 51.43 µs/iter` | ` 41.48 µs` | ` 49.87 µs` | `114.91 µs` | `779.99 µs` |
| yaml    | `240.57 µs/iter` | `176.28 µs` | `242.46 µs` | `912.98 µs` | `  1.97 ms` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `408.96 µs/iter` | `361.34 µs` | `419.74 µs` | `690.63 µs` | `  1.03 ms` |
| js-yaml | `  7.10 ms/iter` | `  6.38 ms` | `  7.34 ms` | `  9.38 ms` | ` 11.25 ms` |
| yaml    | ` 29.74 ms/iter` | ` 27.53 ms` | ` 30.05 ms` | ` 32.40 ms` | ` 32.50 ms` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  4.66 ms/iter` | `  4.25 ms` | `  4.61 ms` | `  8.11 ms` | `  8.16 ms` |
| js-yaml | `107.37 ms/iter` | `104.49 ms` | `105.79 ms` | `116.10 ms` | `116.34 ms` |
| yaml    | `299.95 ms/iter` | `278.12 ms` | `306.11 ms` | `314.33 ms` | `327.36 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `174.53 µs/iter` | `153.93 µs` | `179.48 µs` | `282.10 µs` | `735.78 µs` |
| js-yaml | `  2.86 ms/iter` | `  2.65 ms` | `  2.90 ms` | `  3.37 ms` | `  3.58 ms` |
| yaml    | ` 12.59 ms/iter` | ` 11.45 ms` | ` 12.94 ms` | ` 13.97 ms` | ` 15.75 ms` |

| • stringify · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 73.29 µs/iter` | ` 60.97 µs` | ` 70.52 µs` | `158.79 µs` | `703.20 µs` |
| yaml    | `476.12 µs/iter` | `333.19 µs` | `457.52 µs` | `  1.86 ms` | `  2.51 ms` |

| • stringify · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  6.23 ms/iter` | `  5.73 ms` | `  6.52 ms` | `  7.23 ms` | `  7.89 ms` |
| yaml    | ` 35.94 ms/iter` | ` 34.74 ms` | ` 35.85 ms` | ` 37.98 ms` | ` 38.09 ms` |

| • stringify · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 89.47 ms/iter` | ` 87.49 ms` | ` 89.91 ms` | ` 92.13 ms` | ` 93.83 ms` |
| yaml    | `342.85 ms/iter` | `319.65 ms` | `349.87 ms` | `383.29 ms` | `387.55 ms` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 90.39 MB | 1.00x | -3.01 KB | 1.00x |
| js-yaml | 89.19 MB | 0.99x | 145.37 KB | -48.33x |
| yaml | 95.52 MB | 1.06x | 592.90 KB | -197.12x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 88.61 MB | 1.00x | -6.79 KB | 1.00x |
| js-yaml | 89.42 MB | 1.01x | 117.16 KB | -17.26x |
| yaml | 92.10 MB | 1.04x | 235.20 KB | -34.64x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 90.75 MB | 1.00x | 173.04 KB | 1.00x |
| js-yaml | 106.05 MB | 1.17x | 582.98 KB | 3.37x |
| yaml | 190.37 MB | 2.10x | 1.25 MB | 7.37x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 92.16 MB | 1.00x | 95.74 KB | 1.00x |
| js-yaml | 105.49 MB | 1.14x | 362.94 KB | 3.79x |
| yaml | 142.40 MB | 1.55x | 513.21 KB | 5.36x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 121.52 MB | 1.00x | 1.95 MB | 1.00x |
| js-yaml | 196.45 MB | 1.62x | 4.42 MB | 2.26x |
| yaml | 516.89 MB | 4.25x | 4.23 MB | 2.17x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 108.42 MB | 1.00x | 1.14 MB | 1.00x |
| js-yaml | 159.03 MB | 1.47x | 2.10 MB | 1.85x |
| yaml | 254.01 MB | 2.34x | 518.10 KB | 0.45x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 281.82 MB | 1.00x | 17.43 MB | 1.00x |
| js-yaml | 499.39 MB | 1.77x | 38.04 MB | 2.18x |
| yaml | 3.07 GB | 11.17x | 39.81 MB | 2.28x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 288.71 MB | 1.00x | 10.23 MB | 1.00x |
| js-yaml | 232.86 MB | 0.81x | 15.87 MB | 1.55x |
| yaml | 959.20 MB | 3.32x | 10.18 MB | 0.99x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 94.94 MB | 1.00x | 228.23 KB | 1.00x |
| js-yaml | 117.25 MB | 1.23x | 623.30 KB | 2.73x |
| yaml | 206.61 MB | 2.18x | 1.15 MB | 5.15x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 93.84 MB | 1.00x | 161.20 KB | 1.00x |
| js-yaml | 104.63 MB | 1.12x | 424.63 KB | 2.63x |
| yaml | 154.99 MB | 1.65x | 632.88 KB | 3.93x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 114.40 MB | 1.00x | 1.63 MB | 1.00x |
| js-yaml | 191.80 MB | 1.68x | 3.22 MB | 1.97x |
| yaml | 487.32 MB | 4.26x | 2.01 MB | 1.23x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 107.90 MB | 1.00x | 1.19 MB | 1.00x |
| js-yaml | 154.36 MB | 1.43x | 1.99 MB | 1.67x |
| yaml | 248.10 MB | 2.30x | 1.08 MB | 0.91x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 89.32 MB | — | 177.96 KB | — |
| yaml | 96.33 MB | — | 664.42 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 93.48 MB | 1.00x | -7.96 KB | 1.00x |
| js-yaml | 93.05 MB | 1.00x | 113.88 KB | -14.30x |
| yaml | 95.23 MB | 1.02x | 201.52 KB | -25.31x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 104.51 MB | — | 653.76 KB | — |
| yaml | 170.31 MB | — | 1.19 MB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 114.04 MB | 1.00x | 82.33 KB | 1.00x |
| js-yaml | 127.61 MB | 1.12x | 343.67 KB | 4.17x |
| yaml | 131.68 MB | 1.15x | 455.11 KB | 5.53x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 191.71 MB | — | 4.11 MB | — |
| yaml | 357.79 MB | — | 2.43 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 213.19 MB | 1.00x | 939.70 KB | 1.00x |
| js-yaml | 193.18 MB | 0.91x | 1.70 MB | 1.85x |
| yaml | 249.90 MB | 1.17x | 238.38 KB | 0.25x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 96.85 MB | — | 366.55 KB | — |
| yaml | 163.66 MB | — | 886.45 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 101.45 MB | 1.00x | 42.91 KB | 1.00x |
| js-yaml | 108.07 MB | 1.07x | 229.56 KB | 5.35x |
| yaml | 123.92 MB | 1.22x | 401.61 KB | 9.36x |

**parse · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 93.66 MB | — | 192.91 KB | — |
| yaml | 99.11 MB | — | 734.91 KB | — |

**stringify · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 90.28 MB | — | 115.36 KB | — |
| yaml | 97.21 MB | — | 286.66 KB | — |

**parse · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 106.92 MB | — | 597.86 KB | — |
| yaml | 180.84 MB | — | 1.28 MB | — |

**stringify · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 109.29 MB | — | 368.00 KB | — |
| yaml | 153.86 MB | — | 545.97 KB | — |

**parse · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 155.96 MB | — | 3.01 MB | — |
| yaml | 344.21 MB | — | 1.40 MB | — |

**stringify · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 175.27 MB | — | 1.46 MB | — |
| yaml | 284.43 MB | — | 1.02 MB | — |
<!-- BENCH:COMPETITION:END -->

### Our implementation

<!-- BENCH:OURS:START -->
_Generated by `pnpm bench:self`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~1.75 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.10GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  4.95 µs/iter` | `  4.76 µs` | `  5.00 µs` | `  5.24 µs` | `  5.30 µs` |
| lightning-yaml | ` 11.22 µs/iter` | ` 10.89 µs` | ` 11.35 µs` | ` 11.47 µs` | ` 11.56 µs` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `576.37 µs/iter` | `491.80 µs` | `587.77 µs` | `  1.00 ms` | `  1.49 ms` |
| lightning-yaml | `  1.17 ms/iter` | `999.23 µs` | `  1.22 ms` | `  1.97 ms` | `  2.12 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.58 ms/iter` | `  5.97 ms` | `  6.49 ms` | `  8.55 ms` | `  9.13 ms` |
| lightning-yaml | ` 13.25 ms/iter` | ` 11.64 ms` | ` 14.40 ms` | ` 15.49 ms` | ` 15.53 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 79.94 ms/iter` | ` 70.66 ms` | ` 78.72 ms` | ` 97.24 ms` | `114.00 ms` |
| lightning-yaml | `146.59 ms/iter` | `129.86 ms` | `163.27 ms` | `167.87 ms` | `170.54 ms` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  1.12 ms/iter` | `  1.02 ms` | `  1.14 ms` | `  1.59 ms` | `  2.06 ms` |
| lightning-yaml | `  2.03 ms/iter` | `  1.89 ms` | `  2.03 ms` | `  2.81 ms` | `  3.13 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  8.50 ms/iter` | `  7.79 ms` | `  8.85 ms` | ` 10.55 ms` | ` 11.04 ms` |
| lightning-yaml | ` 15.36 ms/iter` | ` 14.12 ms` | ` 16.10 ms` | ` 17.42 ms` | ` 17.43 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 14.58 µs/iter` | ` 13.87 µs` | ` 14.66 µs` | ` 15.31 µs` | ` 16.72 µs` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  1.76 ms/iter` | `  1.59 ms` | `  1.80 ms` | `  2.65 ms` | `  3.04 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 17.36 ms/iter` | ` 15.97 ms` | ` 18.01 ms` | ` 21.74 ms` | ` 22.22 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `861.34 µs/iter` | `769.03 µs` | `816.28 µs` | `  1.71 ms` | `  1.83 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  3.25 µs/iter` | `  3.14 µs` | `  3.30 µs` | `  3.41 µs` | `  3.46 µs` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `383.60 µs/iter` | `343.88 µs` | `390.36 µs` | `539.22 µs` | `897.80 µs` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  5.23 ms/iter` | `  4.85 ms` | `  5.14 ms` | `  8.41 ms` | `  8.46 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | ` 48.67 ms/iter` | ` 47.65 ms` | ` 49.09 ms` | ` 49.50 ms` | ` 51.91 ms` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `875.20 µs/iter` | `784.65 µs` | `863.64 µs` | `  1.17 ms` | `  5.02 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  6.45 ms/iter` | `  6.13 ms` | `  6.36 ms` | `  9.22 ms` | `  9.48 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  2.68 µs/iter` | `  2.55 µs` | `  2.73 µs` | `  2.84 µs` | `  2.88 µs` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `386.72 µs/iter` | `329.20 µs` | `384.37 µs` | `668.45 µs` | `970.39 µs` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  4.50 ms/iter` | `  4.05 ms` | `  4.52 ms` | `  7.58 ms` | `  7.89 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `178.05 µs/iter` | `159.00 µs` | `183.65 µs` | `228.37 µs` | `669.26 µs` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 92.64 MB | 1.00x | -3.54 KB | 1.00x |
| lightning-yaml | 89.06 MB | 0.96x | 62.63 KB | -17.70x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 88.88 MB | 1.00x | -6.13 KB | 1.00x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 92.54 MB | 1.00x | 172.80 KB | 1.00x |
| lightning-yaml | 97.13 MB | 1.05x | 414.30 KB | 2.40x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 93.76 MB | 1.00x | 96.09 KB | 1.00x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 123.02 MB | 1.00x | 1.95 MB | 1.00x |
| lightning-yaml | 130.16 MB | 1.06x | 3.22 MB | 1.65x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 105.72 MB | 1.00x | 1.13 MB | 1.00x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 278.39 MB | 1.00x | 17.43 MB | 1.00x |
| lightning-yaml | 365.47 MB | 1.31x | 27.75 MB | 1.59x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 288.33 MB | 1.00x | 10.23 MB | 1.00x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 94.98 MB | 1.00x | 228.51 KB | 1.00x |
| lightning-yaml | 93.36 MB | 0.98x | 391.76 KB | 1.71x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 97.46 MB | 1.00x | 161.82 KB | 1.00x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 113.61 MB | 1.00x | 1.63 MB | 1.00x |
| lightning-yaml | 130.87 MB | 1.15x | 1.94 MB | 1.19x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 104.70 MB | 1.00x | 1.19 MB | 1.00x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 89.28 MB | — | 70.02 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 92.89 MB | 1.00x | -9.48 KB | 1.00x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 93.16 MB | — | 464.15 KB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 110.29 MB | 1.00x | 88.88 KB | 1.00x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 128.52 MB | — | 2.73 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 213.49 MB | 1.00x | 939.73 KB | 1.00x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 91.14 MB | — | 263.71 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 104.82 MB | 1.00x | 31.88 KB | 1.00x |
<!-- BENCH:OURS:END -->

## Layout

```
src/
  index.ts             # the parser — parse/stringify (stubs that throw for now)
bench/
  candidates.ts        # candidates + groups + kind; applies/supports gating
  oracle.ts            # the spec oracle (yaml) used by the fixtures + tests
  report.ts            # regenerate README blocks: `report.ts self|competition`
  fixtures/
    datasets.ts        # dataset matrix (category × size × shape) + loaders
    generate.ts        # seeded, reproducible JSON + YAML generator
  speed/
    parse.bench.ts     # mitata parse throughput (sequential)
    stringify.bench.ts # mitata stringify throughput (sequential)
  memory/
    worker.ts          # one isolated (candidate,dataset,op) measurement
    run.ts             # sequential orchestrator + text/markdown formatters
  util/                # seeded PRNG + formatting helpers
test/
  consistency.test.ts  # ours vs. oracle over the benchmark data (red until built)
  fixtures.test.ts     # fixture + oracle sanity (green)
  setup.global.ts      # ensures fixtures exist before the suite runs
vitest.config.ts
```

## Caveats

- The **JSON** fixtures are flow-style (valid YAML, but not block style); the
  **yaml-plain** and **yaml-rich** fixtures cover block style, so both views now
  exist. Rich fixtures are generated with the `yaml` library's 1.1 schema (that's
  what emits `!!binary`), and the `yaml` parser + oracle read them with
  `maxAliasCount: -1`, since the fixtures reuse anchors far past `yaml`'s default
  100-alias DoS cap — fine for trusted, self-generated data.
- For **rich** stringify, output differs by design (js-yaml emits `!!binary`;
  `yaml`, by default, re-emits a Uint8Array as a number sequence) — we're
  measuring each serializer on equivalent in-memory data, not byte-identical text.
- Peak RSS includes Node's fixed baseline, so peak-RSS ratios are conservative;
  the `heap Δ` column isolates the retained result size. At ~1 KB inputs heap Δ
  is dominated by GC noise (it can go negative) — trust peak RSS there.

## Development

I use [Claude](https://www.anthropic.com/claude) as a coding assistant on this
project. Every change is fully code-reviewed and owned by me before it lands.
