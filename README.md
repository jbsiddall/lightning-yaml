# lightning-yaml

A fast YAML parser that aims for `JSON.parse`-class speed and memory, measured
against the two leading JS YAML libraries (`yaml` and `js-yaml`) on **speed** and
**peak memory**, with a consistency suite holding it to the spec.

[`src/index.ts`](src/index.ts) implements `parse`/`parseAll` for the JSON subset
and YAML flow **and** block syntax (milestones M0–M3): plain scalars with YAML
1.2 core-schema typing, single/double quotes with escapes, comments, flow and
block maps/sequences, implicit keys, and compact forms. On the repo's benchmarks
it parses the JSON fixtures at **~0.5× `JSON.parse`** and block YAML at **~58
MB/s**, **~3.6× faster than js-yaml** and **tens of × faster than `yaml`**, with
peak RSS **~1.3× `JSON.parse`** on the 10 MB fixture (see the head-to-head below).

Not implemented yet (they throw `NotImplementedError` or a clear parse error):
`stringify`, block scalars (`|`/`>`), anchors/aliases + tags (`!!binary`), merge
keys, and multi-document streams (`---`/`...`) — so the anchor/`!!binary`
`yaml-rich` fixtures remain the open frontier. The benchmarks and
[vitest](https://vitest.dev) consistency tests are wired to the parser, so
progress shows up directly as green tests and moving numbers.

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

| name           | group       | kind | parse                    | stringify              |
| -------------- | ----------- | ---- | ------------------------ | ---------------------- |
| JSON           | baseline    | json | `JSON.parse`             | `JSON.stringify`       |
| js-yaml        | competition | yaml | `load`                   | `dump`                 |
| yaml           | competition | yaml | `parse`                  | `stringify`            |
| lightning-yaml | ours        | yaml | `src/index.ts` _(M0–M3)_ | _(not implemented)_    |

`lightning-yaml` (group `ours`) is wired to [`src/index.ts`](src/index.ts). Its
`parse` handles the JSON subset + YAML flow/block syntax; `stringify` is a later
milestone, so `Candidate.stringify` is optional and the stringify benches/tests
skip our parser rather than borrow another library's output. A per-fixture
capability probe (`candidateHandles`) benchmarks it only on inputs it can read
today — so it appears on the JSON and block `yaml-plain` rows but not the
anchor/`!!binary` `yaml-rich` rows. Each candidate's `kind` (`json` vs. `yaml`)
decides which data categories it runs on.

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
  `lightning-yaml.parse(text)` must deep-equal `oracle.parse(text)`. (The
  stringify round-trip is skipped while our dumper is unimplemented — we don't
  substitute a foreign serializer.) Rich fixtures additionally assert that
  `&anchor`/`*alias` reuse is reconstructed as **shared references**, not deep
  copies. Today the **JSON and block `yaml-plain` cases pass**; the `yaml-rich`
  cases stay red until anchors + `!!binary` land — each red test is a concrete
  spec the next milestone must satisfy.
- **[`test/parser.unit.ts`](test/parser.unit.ts)** — the parser's own fast
  node:test suite (`pnpm test:unit`): exact `JSON.parse` parity on the JSON
  fixtures, an escape/unicode/bignum torture set, prototype-pollution and
  depth-guard security, a seeded block round-trip corpus, and a regression case
  for every adversarial-review finding.
- **[`test/fixtures.test.ts`](test/fixtures.test.ts)** — sanity checks on the
  fixtures and oracle themselves: they parse deterministically, JSON-compatible
  data round-trips, rich fixtures really do contain `!!binary`/anchors and plain
  ones don't. These **pass**, so a red consistency test unambiguously means "ours
  is wrong", not "the harness is broken".

The suite is not a benchmark and doesn't measure anything; it's the correctness
gate that makes the benchmark numbers meaningful.

## Usage

```bash
pnpm install
pnpm gen:fixtures       # generate bench/fixtures/data/* — JSON + YAML (gitignored, reproducible)

pnpm test               # vitest consistency suite (ours vs. the yaml oracle)
pnpm test:unit          # the parser's own node:test suite (fast, standalone)

# low-level runners (all candidates by default; BENCH_SCOPE=competition|ours to filter)
pnpm bench:speed        # mitata parse + stringify throughput
pnpm bench:memory       # peak RSS + retained heap per candidate (sequential)

# report generators — refresh the README results blocks
pnpm bench:self         # our implementation + JSON baseline (fast) — run before every commit/PR
pnpm bench:competition  # full head-to-head, all parsers (slow) — run on dep/dataset/milestone changes
pnpm bench              # gen:fixtures + competition + self

pnpm typecheck
```

The two report scripts refresh two different README blocks on two different
cadences — see [CLAUDE.md](CLAUDE.md):

- **`bench:self`** benchmarks only this repo's parser (+ JSON baseline) and is
  fast; run it before every commit to track our progress cheaply.
- **`bench:competition`** benchmarks the full matrix — every parser including
  lightning-yaml — and is slow (xlarge/yaml); re-run it when dependency versions,
  datasets, or (for a fresh head-to-head snapshot) our parser change.

## Benchmark results

> Representative snapshots on the maintainer's machine. Numbers drift run-to-run;
> peak-RSS / heap-Δ are the stable figures. Regenerate with the commands above.

### All parsers — head-to-head

The full matrix with **every** parser in one place — `JSON` (baseline), the
competition (`js-yaml`, `yaml`), and **`lightning-yaml`** — so our numbers sit
directly against theirs. Where a row shows only some parsers, the others can't
read that fixture (e.g. `JSON.parse` and `lightning-yaml` don't yet parse the
anchor/`!!binary` `yaml-rich` fixtures). Refreshed by the slow `bench:competition`
run; the fast per-commit tracker for our parser alone is the "Our implementation"
block below.

<!-- BENCH:COMPETITION:START -->
_Generated by `pnpm bench:competition`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~1.73 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.10GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  4.88 µs/iter` | `  4.76 µs` | `  4.93 µs` | `  4.96 µs` | `  4.98 µs` |
| js-yaml        | ` 38.58 µs/iter` | ` 30.96 µs` | ` 36.61 µs` | ` 91.42 µs` | `546.73 µs` |
| yaml           | `541.72 µs/iter` | `410.41 µs` | `529.94 µs` | `  1.26 ms` | `  1.64 ms` |
| lightning-yaml | ` 10.96 µs/iter` | ` 10.71 µs` | ` 11.06 µs` | ` 11.14 µs` | ` 11.31 µs` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `564.87 µs/iter` | `501.77 µs` | `570.70 µs` | `947.17 µs` | `  1.34 ms` |
| js-yaml        | `  4.25 ms/iter` | `  3.76 ms` | `  4.55 ms` | `  5.72 ms` | `  5.95 ms` |
| yaml           | ` 68.00 ms/iter` | ` 59.77 ms` | ` 69.07 ms` | ` 74.55 ms` | ` 84.76 ms` |
| lightning-yaml | `  1.13 ms/iter` | `  1.00 ms` | `  1.14 ms` | `  1.90 ms` | `  2.21 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.61 ms/iter` | `  6.16 ms` | `  6.45 ms` | `  8.35 ms` | `  8.37 ms` |
| js-yaml        | ` 47.66 ms/iter` | ` 45.18 ms` | ` 48.93 ms` | ` 50.92 ms` | ` 51.85 ms` |
| yaml           | `722.74 ms/iter` | `671.48 ms` | `763.41 ms` | `773.56 ms` | `783.95 ms` |
| lightning-yaml | ` 13.06 ms/iter` | ` 11.64 ms` | ` 14.21 ms` | ` 14.85 ms` | ` 14.97 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 75.71 ms/iter` | ` 68.08 ms` | ` 72.45 ms` | ` 79.24 ms` | `120.64 ms` |
| js-yaml        | `478.99 ms/iter` | `421.41 ms` | `525.02 ms` | `553.47 ms` | `586.18 ms` |
| yaml           | `   8.66 s/iter` | `   7.06 s` | `   8.79 s` | `  10.87 s` | `  11.22 s` |
| lightning-yaml | `134.86 ms/iter` | `126.03 ms` | `137.46 ms` | `139.93 ms` | `142.76 ms` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  1.12 ms/iter` | `  1.04 ms` | `  1.12 ms` | `  1.82 ms` | `  2.16 ms` |
| js-yaml        | `  7.69 ms/iter` | `  6.85 ms` | `  8.04 ms` | `  9.99 ms` | ` 10.82 ms` |
| yaml           | `103.39 ms/iter` | ` 93.94 ms` | `103.75 ms` | `105.74 ms` | `135.24 ms` |
| lightning-yaml | `  1.99 ms/iter` | `  1.85 ms` | `  2.00 ms` | `  2.82 ms` | `  2.90 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  8.31 ms/iter` | `  7.81 ms` | `  8.25 ms` | ` 10.67 ms` | ` 11.00 ms` |
| js-yaml        | ` 55.51 ms/iter` | ` 52.90 ms` | ` 59.33 ms` | ` 60.01 ms` | ` 60.65 ms` |
| yaml           | `748.42 ms/iter` | `688.20 ms` | `770.46 ms` | `783.07 ms` | `801.91 ms` |
| lightning-yaml | ` 15.32 ms/iter` | ` 13.66 ms` | ` 16.26 ms` | ` 20.38 ms` | ` 20.78 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | ` 49.33 µs/iter` | ` 41.97 µs` | ` 46.79 µs` | `104.73 µs` | `666.56 µs` |
| yaml           | `606.94 µs/iter` | `462.88 µs` | `577.15 µs` | `  1.33 ms` | `  1.76 ms` |
| lightning-yaml | ` 13.81 µs/iter` | ` 13.59 µs` | ` 13.89 µs` | ` 13.97 µs` | ` 14.06 µs` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  6.39 ms/iter` | `  5.86 ms` | `  6.60 ms` | `  7.65 ms` | `  8.30 ms` |
| yaml           | ` 88.90 ms/iter` | ` 75.43 ms` | ` 92.05 ms` | `108.20 ms` | `114.80 ms` |
| lightning-yaml | `  1.61 ms/iter` | `  1.51 ms` | `  1.61 ms` | `  2.41 ms` | `  2.54 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | ` 66.32 ms/iter` | ` 62.24 ms` | ` 69.53 ms` | ` 72.78 ms` | ` 75.99 ms` |
| yaml           | `812.39 ms/iter` | `755.67 ms` | `841.69 ms` | `866.75 ms` | `900.81 ms` |
| lightning-yaml | ` 16.14 ms/iter` | ` 15.38 ms` | ` 16.83 ms` | ` 17.94 ms` | ` 18.37 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  2.69 ms/iter` | `  2.43 ms` | `  2.76 ms` | `  3.50 ms` | `  3.58 ms` |
| yaml           | ` 34.19 ms/iter` | ` 31.34 ms` | ` 35.24 ms` | ` 36.92 ms` | ` 42.08 ms` |
| lightning-yaml | `849.75 µs/iter` | `761.75 µs` | `833.10 µs` | `  1.54 ms` | `  1.93 ms` |

| • parse · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 68.41 µs/iter` | ` 55.37 µs` | ` 72.30 µs` | `152.61 µs` | `788.81 µs` |
| yaml    | `804.86 µs/iter` | `629.79 µs` | `804.50 µs` | `  1.66 ms` | `  2.13 ms` |

| • parse · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  5.40 ms/iter` | `  5.05 ms` | `  5.48 ms` | `  6.26 ms` | `  6.64 ms` |
| yaml    | ` 62.09 ms/iter` | ` 55.05 ms` | ` 61.53 ms` | ` 70.83 ms` | ` 91.60 ms` |

| • parse · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 52.31 ms/iter` | ` 51.52 ms` | ` 52.68 ms` | ` 53.00 ms` | ` 53.50 ms` |
| yaml    | `752.86 ms/iter` | `734.56 ms` | `759.04 ms` | `761.65 ms` | `778.41 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  3.32 µs/iter` | `  3.23 µs` | `  3.37 µs` | `  3.45 µs` | `  3.48 µs` |
| js-yaml | ` 58.37 µs/iter` | ` 50.17 µs` | ` 57.63 µs` | `106.22 µs` | `765.99 µs` |
| yaml    | `262.12 µs/iter` | `207.01 µs` | `255.72 µs` | `  1.50 ms` | `  1.82 ms` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `402.81 µs/iter` | `358.63 µs` | `405.32 µs` | `593.57 µs` | `  1.08 ms` |
| js-yaml | `  7.29 ms/iter` | `  6.46 ms` | `  7.72 ms` | `  8.91 ms` | `  9.16 ms` |
| yaml    | ` 28.81 ms/iter` | ` 27.41 ms` | ` 29.44 ms` | ` 31.36 ms` | ` 31.45 ms` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  5.42 ms/iter` | `  5.04 ms` | `  5.30 ms` | `  8.45 ms` | `  8.68 ms` |
| js-yaml | `146.94 ms/iter` | `140.37 ms` | `149.37 ms` | `150.07 ms` | `156.40 ms` |
| yaml    | `335.11 ms/iter` | `319.07 ms` | `342.88 ms` | `345.46 ms` | `353.05 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | ` 67.33 ms/iter` | ` 64.74 ms` | ` 67.33 ms` | ` 70.49 ms` | ` 71.61 ms` |
| js-yaml | `   5.74 s/iter` | `   5.63 s` | `   5.76 s` | `   5.86 s` | `   5.86 s` |
| yaml    | `   3.30 s/iter` | `   3.10 s` | `   3.38 s` | `   3.39 s` | `   3.44 s` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `895.10 µs/iter` | `787.09 µs` | `879.78 µs` | `  1.18 ms` | `  5.55 ms` |
| js-yaml | ` 13.78 ms/iter` | ` 12.65 ms` | ` 14.12 ms` | ` 15.04 ms` | ` 15.06 ms` |
| yaml    | ` 51.02 ms/iter` | ` 48.54 ms` | ` 51.11 ms` | ` 52.45 ms` | ` 56.72 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  6.52 ms/iter` | `  6.13 ms` | `  6.48 ms` | `  9.45 ms` | `  9.73 ms` |
| js-yaml | `192.96 ms/iter` | `187.52 ms` | `194.76 ms` | `197.93 ms` | `200.90 ms` |
| yaml    | `351.11 ms/iter` | `327.68 ms` | `363.79 ms` | `379.29 ms` | `401.74 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  2.72 µs/iter` | `  2.63 µs` | `  2.77 µs` | `  2.84 µs` | `  2.92 µs` |
| js-yaml | ` 47.03 µs/iter` | ` 38.44 µs` | ` 46.50 µs` | ` 95.09 µs` | `696.41 µs` |
| yaml    | `227.26 µs/iter` | `160.33 µs` | `224.94 µs` | `  1.45 ms` | `  3.01 ms` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `394.88 µs/iter` | `347.26 µs` | `403.68 µs` | `617.62 µs` | `  1.02 ms` |
| js-yaml | `  6.53 ms/iter` | `  6.03 ms` | `  6.85 ms` | `  8.05 ms` | `  8.69 ms` |
| yaml    | ` 26.62 ms/iter` | ` 25.19 ms` | ` 27.21 ms` | ` 28.25 ms` | ` 28.78 ms` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  4.80 ms/iter` | `  4.21 ms` | `  5.07 ms` | `  7.59 ms` | `  8.11 ms` |
| js-yaml | `111.62 ms/iter` | `107.78 ms` | `111.89 ms` | `119.11 ms` | `120.24 ms` |
| yaml    | `296.41 ms/iter` | `267.42 ms` | `299.63 ms` | `310.45 ms` | `340.10 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `185.42 µs/iter` | `161.25 µs` | `191.40 µs` | `271.60 µs` | `834.95 µs` |
| js-yaml | `  3.03 ms/iter` | `  2.59 ms` | `  3.05 ms` | `  3.67 ms` | `  3.75 ms` |
| yaml    | ` 11.91 ms/iter` | ` 10.09 ms` | ` 12.44 ms` | ` 14.64 ms` | ` 14.71 ms` |

| • stringify · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 66.34 µs/iter` | ` 57.21 µs` | ` 63.68 µs` | `130.78 µs` | `619.44 µs` |
| yaml    | `384.58 µs/iter` | `282.75 µs` | `375.39 µs` | `  1.68 ms` | `  2.25 ms` |

| • stringify · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  6.38 ms/iter` | `  5.40 ms` | `  6.72 ms` | `  7.97 ms` | `  8.19 ms` |
| yaml    | ` 34.04 ms/iter` | ` 31.14 ms` | ` 34.80 ms` | ` 35.71 ms` | ` 38.59 ms` |

| • stringify · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 94.19 ms/iter` | ` 89.30 ms` | ` 95.28 ms` | `101.34 ms` | `110.07 ms` |
| yaml    | `339.03 ms/iter` | `315.35 ms` | `352.59 ms` | `361.32 ms` | `363.54 ms` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 88.98 MB | 1.00x | -5.03 KB | 1.00x |
| js-yaml | 92.61 MB | 1.04x | 145.98 KB | -29.01x |
| yaml | 98.97 MB | 1.11x | 593.47 KB | -117.96x |
| lightning-yaml | 92.96 MB | 1.04x | 62.22 KB | -12.37x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 89.17 MB | 1.00x | -6.15 KB | 1.00x |
| js-yaml | 89.23 MB | 1.00x | 117.64 KB | -19.13x |
| yaml | 91.35 MB | 1.02x | 233.91 KB | -38.04x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 94.59 MB | 1.00x | 173.92 KB | 1.00x |
| js-yaml | 102.70 MB | 1.09x | 582.05 KB | 3.35x |
| yaml | 177.14 MB | 1.87x | 1.25 MB | 7.36x |
| lightning-yaml | 93.48 MB | 0.99x | 420.08 KB | 2.42x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 94.34 MB | 1.00x | 97.20 KB | 1.00x |
| js-yaml | 101.74 MB | 1.08x | 362.55 KB | 3.73x |
| yaml | 142.17 MB | 1.51x | 516.77 KB | 5.32x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 123.23 MB | 1.00x | 1.95 MB | 1.00x |
| js-yaml | 195.59 MB | 1.59x | 4.42 MB | 2.26x |
| yaml | 518.75 MB | 4.21x | 4.24 MB | 2.17x |
| lightning-yaml | 129.97 MB | 1.05x | 3.22 MB | 1.65x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 104.99 MB | 1.00x | 1.14 MB | 1.00x |
| js-yaml | 156.08 MB | 1.49x | 2.10 MB | 1.85x |
| yaml | 257.30 MB | 2.45x | 518.88 KB | 0.45x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 282.13 MB | 1.00x | 17.43 MB | 1.00x |
| js-yaml | 497.90 MB | 1.76x | 38.04 MB | 2.18x |
| yaml | 3.16 GB | 11.47x | 39.81 MB | 2.28x |
| lightning-yaml | 366.57 MB | 1.30x | 27.75 MB | 1.59x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 283.18 MB | 1.00x | 10.23 MB | 1.00x |
| js-yaml | 256.64 MB | 0.91x | 15.89 MB | 1.55x |
| yaml | 742.33 MB | 2.62x | 10.17 MB | 0.99x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.30 MB | 1.00x | 227.72 KB | 1.00x |
| js-yaml | 117.79 MB | 1.29x | 623.13 KB | 2.74x |
| yaml | 201.18 MB | 2.20x | 1.14 MB | 5.15x |
| lightning-yaml | 93.23 MB | 1.02x | 389.32 KB | 1.71x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 97.11 MB | 1.00x | 161.82 KB | 1.00x |
| js-yaml | 102.35 MB | 1.05x | 424.51 KB | 2.62x |
| yaml | 151.49 MB | 1.56x | 631.97 KB | 3.91x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 112.72 MB | 1.00x | 1.63 MB | 1.00x |
| js-yaml | 192.97 MB | 1.71x | 3.22 MB | 1.97x |
| yaml | 452.10 MB | 4.01x | 2.02 MB | 1.24x |
| lightning-yaml | 130.61 MB | 1.16x | 1.96 MB | 1.20x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 108.54 MB | 1.00x | 1.19 MB | 1.00x |
| js-yaml | 155.16 MB | 1.43x | 1.98 MB | 1.67x |
| yaml | 247.58 MB | 2.28x | 2.18 MB | 1.84x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 88.79 MB | — | 166.29 KB | — |
| yaml | 93.74 MB | — | 664.37 KB | — |
| lightning-yaml | 92.23 MB | — | 70.06 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 88.76 MB | 1.00x | -7.42 KB | 1.00x |
| js-yaml | 93.50 MB | 1.05x | 113.28 KB | -15.26x |
| yaml | 92.79 MB | 1.05x | 192.96 KB | -26.00x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 102.54 MB | — | 649.02 KB | — |
| yaml | 186.42 MB | — | 1.19 MB | — |
| lightning-yaml | 93.29 MB | — | 472.52 KB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 112.58 MB | 1.00x | 81.81 KB | 1.00x |
| js-yaml | 124.78 MB | 1.11x | 343.76 KB | 4.20x |
| yaml | 134.46 MB | 1.19x | 454.00 KB | 5.55x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 191.00 MB | — | 4.11 MB | — |
| yaml | 440.32 MB | — | 2.44 MB | — |
| lightning-yaml | 132.46 MB | — | 2.75 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 211.56 MB | 1.00x | 939.70 KB | 1.00x |
| js-yaml | 195.17 MB | 0.92x | 1.70 MB | 1.85x |
| yaml | 262.55 MB | 1.24x | 239.43 KB | 0.25x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 93.65 MB | — | 366.63 KB | — |
| yaml | 163.16 MB | — | 898.96 KB | — |
| lightning-yaml | 91.85 MB | — | 263.68 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 103.23 MB | 1.00x | 31.88 KB | 1.00x |
| js-yaml | 104.29 MB | 1.01x | 229.23 KB | 7.19x |
| yaml | 121.04 MB | 1.17x | 401.09 KB | 12.58x |

**parse · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 89.70 MB | — | 191.96 KB | — |
| yaml | 96.10 MB | — | 736.50 KB | — |

**stringify · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 91.84 MB | — | 111.23 KB | — |
| yaml | 97.73 MB | — | 271.20 KB | — |

**parse · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 102.58 MB | — | 596.98 KB | — |
| yaml | 178.00 MB | — | 1.29 MB | — |

**stringify · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 112.07 MB | — | 367.48 KB | — |
| yaml | 159.35 MB | — | 545.46 KB | — |

**parse · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 162.40 MB | — | 3.01 MB | — |
| yaml | 359.71 MB | — | 1.41 MB | — |

**stringify · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 176.99 MB | — | 1.46 MB | — |
| yaml | 290.91 MB | — | 1.02 MB | — |
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
  index.ts             # the parser — parse/parseAll (M0–M3); stringify still a stub
bench/
  candidates.ts        # candidates + groups + kind; applies/supports/handles gating
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
  consistency.test.ts  # ours vs. oracle over the benchmark data (JSON + yaml-plain green)
  parser.unit.ts       # the parser's own node:test suite (parity, torture, regressions)
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
