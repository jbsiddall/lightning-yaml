# lightning-yaml

A fast YAML parser that aims for `JSON.parse`-class speed and memory, measured
against the two leading JS YAML libraries (`yaml` and `js-yaml`) on **speed** and
**peak memory**, with a consistency suite holding it to the spec.

[`src/index.ts`](src/index.ts) implements `parse`/`parseAll` for the full YAML
1.2 core feature set (milestones **M0–M5**): the JSON subset, YAML flow and
block syntax, plain scalars with 1.2 core-schema typing, single/double quotes
with escapes, comments, flow and block maps/sequences, implicit keys, compact
forms, block scalars (`|`/`>` with chomping and indent indicators),
anchors/aliases (`&`/`*`, with structural sharing), tags including `!!binary` →
`Uint8Array` plus `%YAML`/`%TAG` directives, `---`/`...` document markers and
multi-document streams, and explicit `? key`/`: value` block mappings. Only
`stringify` remains a stub (a deliberate v1 non-goal); merge keys (`<<`) aren't
in the test corpus and are unimplemented too.

On the [yaml-test-suite](https://github.com/yaml/yaml-test-suite) — the
project's headline correctness result — lightning-yaml scores **364/373
(97.6%)**, ahead of **js-yaml v5.2.1 at 354/373 (94.9%)** and even the **`yaml`
oracle at 362/373 (97.1%)**, with **100% (91/91) on the negative/error cases**.
The 9 remaining misses are spec corners `yaml` itself also fails. Reproduce with
`pnpm test:suite` (runner: [`bench/conformance/`](bench/conformance/)).

On the repo's benchmarks it parses the JSON fixtures at **~0.46× `JSON.parse`**
and block YAML at **~39 MB/s**, **~4× faster than js-yaml** and **~38× faster
than `yaml`**, with peak RSS **~1.3× `JSON.parse`** on the 10 MB fixture (see
the head-to-head below). The benchmarks and [vitest](https://vitest.dev)
consistency tests are wired to the parser, so progress shows up directly as
green tests and moving numbers.

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
| lightning-yaml | ours        | yaml | `src/index.ts` _(M0–M5)_ | _(not implemented)_    |

`lightning-yaml` (group `ours`) is wired to [`src/index.ts`](src/index.ts). Its
`parse` now covers the full YAML 1.2 core feature set — flow/block syntax,
block scalars, anchors/aliases, tags including `!!binary`, directives, and
multi-document streams; `stringify` remains unimplemented (a deliberate v1
non-goal), so `Candidate.stringify` is optional and the stringify benches/tests
skip our parser rather than borrow another library's output. A per-fixture
capability probe (`candidateHandles`) benchmarks it only on inputs it can read
today — now the JSON, block `yaml-plain`, **and** anchor/`!!binary` `yaml-rich`
rows, since `parse` handles all three categories. Each candidate's `kind`
(`json` vs. `yaml`) decides which data categories it runs on.

## Correctness — the consistency suite

Speed is meaningless if the output is wrong, so before the parser is trusted it
has to agree with a reference. We deliberately pick **one** oracle rather than
cross-checking every library against every other — they still legitimately
disagree on schema-typing edge cases, tag/anchor handling, and error
strictness (this is no longer a YAML-1.1-vs-1.2 split: js-yaml **v5**'s default
schema is now 1.2 core too, same as `yaml`): [`bench/oracle.ts`](bench/oracle.ts)
designates **`yaml`** — the more spec-compliant of the two reference libraries,
per the yaml-test-suite result above — as ground truth. It's the only
competitor we compare ourselves against for correctness. The oracle
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
  copies. Today the suite is **fully green** across all three categories — JSON,
  block `yaml-plain`, and `yaml-rich` alike; it stayed red on `yaml-rich` only
  until anchors + `!!binary` landed.
- **[`test/parser.unit.ts`](test/parser.unit.ts)** — the parser's own fast
  node:test suite (`pnpm test:unit`, **364/364 passing**): exact `JSON.parse`
  parity on the JSON fixtures, an escape/unicode/bignum torture set,
  prototype-pollution and depth-guard security, a seeded block round-trip
  corpus, and a regression case for every adversarial-review finding.
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
pnpm test:suite         # yaml-test-suite conformance runner (364/373, 97.6%)

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
(or don't yet) handle that fixture/op — e.g. `JSON.parse` can't read block
`yaml-plain`/`yaml-rich` fixtures at all, and `lightning-yaml` doesn't stringify
anything yet, but it now parses all three categories including anchor/`!!binary`
`yaml-rich`. Refreshed by the slow `bench:competition` run; the fast per-commit
tracker for our parser alone is the "Our implementation" block below.

<!-- BENCH:COMPETITION:START -->
_Generated by `pnpm bench:competition`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~1.56 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.80GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.47 µs/iter` | `  6.37 µs` | `  6.50 µs` | `  6.60 µs` | `  6.62 µs` |
| js-yaml        | ` 64.15 µs/iter` | ` 50.18 µs` | ` 61.12 µs` | `159.33 µs` | `791.44 µs` |
| yaml           | `733.02 µs/iter` | `523.94 µs` | `624.30 µs` | `  3.04 ms` | `  5.74 ms` |
| lightning-yaml | ` 16.97 µs/iter` | ` 16.64 µs` | ` 16.91 µs` | ` 17.67 µs` | ` 17.67 µs` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `695.35 µs/iter` | `645.83 µs` | `699.99 µs` | `962.15 µs` | `  1.49 ms` |
| js-yaml        | `  5.91 ms/iter` | `  5.48 ms` | `  6.10 ms` | `  8.44 ms` | `  9.51 ms` |
| yaml           | ` 75.22 ms/iter` | ` 64.48 ms` | ` 75.85 ms` | ` 97.51 ms` | `101.08 ms` |
| lightning-yaml | `  1.65 ms/iter` | `  1.56 ms` | `  1.63 ms` | `  2.54 ms` | `  2.66 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  8.10 ms/iter` | `  7.65 ms` | `  7.80 ms` | ` 10.45 ms` | ` 10.56 ms` |
| js-yaml        | ` 83.86 ms/iter` | ` 80.61 ms` | ` 83.93 ms` | ` 89.08 ms` | ` 90.68 ms` |
| yaml           | `794.17 ms/iter` | `756.01 ms` | `786.06 ms` | `860.14 ms` | `882.00 ms` |
| lightning-yaml | ` 20.08 ms/iter` | ` 18.01 ms` | ` 21.45 ms` | ` 22.51 ms` | ` 22.63 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 88.36 ms/iter` | ` 84.28 ms` | ` 87.88 ms` | ` 90.69 ms` | `104.60 ms` |
| js-yaml        | `824.77 ms/iter` | `774.67 ms` | `837.10 ms` | `844.47 ms` | `907.78 ms` |
| yaml           | `   8.03 s/iter` | `   7.59 s` | `   8.25 s` | `   8.49 s` | `   8.65 s` |
| lightning-yaml | `192.48 ms/iter` | `184.94 ms` | `194.32 ms` | `198.24 ms` | `205.92 ms` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  1.42 ms/iter` | `  1.34 ms` | `  1.42 ms` | `  2.03 ms` | `  2.77 ms` |
| js-yaml        | ` 10.99 ms/iter` | `  9.39 ms` | ` 12.04 ms` | ` 13.44 ms` | ` 13.62 ms` |
| yaml           | `112.49 ms/iter` | `102.04 ms` | `117.06 ms` | `122.01 ms` | `146.78 ms` |
| lightning-yaml | `  2.92 ms/iter` | `  2.81 ms` | `  2.91 ms` | `  3.83 ms` | `  4.08 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 10.33 ms/iter` | `  9.93 ms` | ` 10.09 ms` | ` 12.82 ms` | ` 13.00 ms` |
| js-yaml        | ` 98.16 ms/iter` | ` 91.63 ms` | `100.71 ms` | `105.49 ms` | `117.08 ms` |
| yaml           | `813.75 ms/iter` | `760.89 ms` | `823.85 ms` | `853.81 ms` | `971.64 ms` |
| lightning-yaml | ` 21.91 ms/iter` | ` 20.79 ms` | ` 22.98 ms` | ` 24.52 ms` | ` 24.58 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | ` 64.06 µs/iter` | ` 54.62 µs` | ` 61.21 µs` | `140.70 µs` | `626.75 µs` |
| yaml           | `746.68 µs/iter` | `598.67 µs` | `717.54 µs` | `  1.92 ms` | `  2.21 ms` |
| lightning-yaml | ` 20.60 µs/iter` | ` 20.48 µs` | ` 20.63 µs` | ` 20.77 µs` | ` 20.83 µs` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  7.55 ms/iter` | `  7.02 ms` | `  7.92 ms` | `  9.33 ms` | `  9.35 ms` |
| yaml           | ` 97.67 ms/iter` | ` 91.40 ms` | ` 96.55 ms` | `107.08 ms` | `122.90 ms` |
| lightning-yaml | `  2.55 ms/iter` | `  2.41 ms` | `  2.50 ms` | `  3.75 ms` | `  4.06 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `104.07 ms/iter` | ` 91.33 ms` | `115.02 ms` | `123.48 ms` | `125.92 ms` |
| yaml           | `970.45 ms/iter` | `944.58 ms` | `977.16 ms` | `   1.01 s` | `   1.02 s` |
| lightning-yaml | ` 25.76 ms/iter` | ` 24.51 ms` | ` 27.19 ms` | ` 27.51 ms` | ` 28.34 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  3.75 ms/iter` | `  3.34 ms` | `  3.93 ms` | `  5.27 ms` | `  6.44 ms` |
| yaml           | ` 39.71 ms/iter` | ` 37.71 ms` | ` 39.89 ms` | ` 41.84 ms` | ` 42.93 ms` |
| lightning-yaml | `  1.25 ms/iter` | `  1.20 ms` | `  1.26 ms` | `  1.71 ms` | `  2.06 ms` |

| • parse · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| yaml           | `  1.02 ms/iter` | `806.14 µs` | `999.14 µs` | `  2.17 ms` | `  2.45 ms` |
| lightning-yaml | ` 31.46 µs/iter` | ` 28.91 µs` | ` 32.50 µs` | ` 33.71 µs` | ` 38.49 µs` |

| • parse · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| yaml           | ` 77.10 ms/iter` | ` 69.24 ms` | ` 73.72 ms` | ` 90.60 ms` | `110.47 ms` |
| lightning-yaml | `  2.19 ms/iter` | `  2.09 ms` | `  2.17 ms` | `  3.27 ms` | `  3.34 ms` |

| • parse · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| yaml           | `   1.02 s/iter` | `961.65 ms` | `   1.05 s` | `   1.06 s` | `   1.06 s` |
| lightning-yaml | ` 21.20 ms/iter` | ` 20.27 ms` | ` 22.13 ms` | ` 22.92 ms` | ` 23.09 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  4.42 µs/iter` | `  4.36 µs` | `  4.50 µs` | `  4.58 µs` | `  4.59 µs` |
| js-yaml | `126.78 µs/iter` | `102.90 µs` | `121.70 µs` | `242.33 µs` | `  2.56 ms` |
| yaml    | `353.51 µs/iter` | `283.24 µs` | `342.62 µs` | `  1.71 ms` | `  2.10 ms` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `520.19 µs/iter` | `451.86 µs` | `507.06 µs` | `956.35 µs` | `  1.12 ms` |
| js-yaml | ` 15.27 ms/iter` | ` 12.77 ms` | ` 16.14 ms` | ` 21.30 ms` | ` 21.49 ms` |
| yaml    | ` 36.20 ms/iter` | ` 34.85 ms` | ` 36.26 ms` | ` 38.94 ms` | ` 40.76 ms` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  6.42 ms/iter` | `  5.98 ms` | `  6.22 ms` | ` 11.14 ms` | ` 11.17 ms` |
| js-yaml | `169.81 ms/iter` | `162.35 ms` | `168.28 ms` | `182.75 ms` | `186.33 ms` |
| yaml    | `439.61 ms/iter` | `418.36 ms` | `451.01 ms` | `467.57 ms` | `487.41 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | ` 65.26 ms/iter` | ` 60.56 ms` | ` 62.36 ms` | ` 71.51 ms` | ` 88.08 ms` |
| js-yaml | `   1.61 s/iter` | `   1.50 s` | `   1.62 s` | `   1.75 s` | `   1.90 s` |
| yaml    | `   3.88 s/iter` | `   3.78 s` | `   3.92 s` | `   3.93 s` | `   4.01 s` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `959.24 µs/iter` | `842.93 µs` | `931.05 µs` | `  1.39 ms` | `  7.68 ms` |
| js-yaml | ` 22.71 ms/iter` | ` 22.11 ms` | ` 23.06 ms` | ` 23.50 ms` | ` 23.97 ms` |
| yaml    | ` 64.80 ms/iter` | ` 59.30 ms` | ` 68.18 ms` | ` 70.59 ms` | ` 81.06 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  7.44 ms/iter` | `  6.42 ms` | `  7.15 ms` | ` 12.03 ms` | ` 12.07 ms` |
| js-yaml | `196.45 ms/iter` | `186.27 ms` | `199.32 ms` | `203.80 ms` | `220.58 ms` |
| yaml    | `447.65 ms/iter` | `422.42 ms` | `467.03 ms` | `472.49 ms` | `504.91 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  3.56 µs/iter` | `  3.47 µs` | `  3.63 µs` | `  3.74 µs` | `  3.74 µs` |
| js-yaml | ` 99.34 µs/iter` | ` 78.21 µs` | ` 93.23 µs` | `223.90 µs` | `931.43 µs` |
| yaml    | `300.48 µs/iter` | `215.89 µs` | `294.93 µs` | `  1.01 ms` | `  2.54 ms` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `503.86 µs/iter` | `423.52 µs` | `501.37 µs` | `858.86 µs` | `  1.14 ms` |
| js-yaml | ` 12.34 ms/iter` | ` 11.31 ms` | ` 12.89 ms` | ` 14.41 ms` | ` 14.46 ms` |
| yaml    | ` 34.94 ms/iter` | ` 33.21 ms` | ` 35.36 ms` | ` 36.47 ms` | ` 38.08 ms` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `  5.63 ms/iter` | `  5.00 ms` | `  5.76 ms` | ` 10.50 ms` | ` 10.57 ms` |
| js-yaml | `154.76 ms/iter` | `147.22 ms` | `154.33 ms` | `165.71 ms` | `172.94 ms` |
| yaml    | `353.66 ms/iter` | `339.24 ms` | `354.13 ms` | `372.65 ms` | `373.22 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON    | `214.37 µs/iter` | `191.03 µs` | `216.01 µs` | `352.16 µs` | `760.00 µs` |
| js-yaml | `  5.22 ms/iter` | `  4.73 ms` | `  5.50 ms` | `  7.04 ms` | `  7.28 ms` |
| yaml    | ` 15.30 ms/iter` | ` 13.70 ms` | ` 15.63 ms` | ` 19.01 ms` | ` 21.46 ms` |

| • stringify · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `115.10 µs/iter` | ` 97.62 µs` | `111.39 µs` | `238.12 µs` | `829.48 µs` |
| yaml    | `527.97 µs/iter` | `399.67 µs` | `507.26 µs` | `  2.07 ms` | `  2.72 ms` |

| • stringify · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | `  9.03 ms/iter` | `  8.28 ms` | `  9.65 ms` | ` 10.16 ms` | ` 10.41 ms` |
| yaml    | ` 41.47 ms/iter` | ` 40.11 ms` | ` 42.30 ms` | ` 42.70 ms` | ` 42.73 ms` |

| • stringify · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| ------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml | ` 99.20 ms/iter` | ` 95.05 ms` | ` 99.02 ms` | `102.09 ms` | `111.39 ms` |
| yaml    | `402.60 ms/iter` | `390.39 ms` | `407.81 ms` | `411.94 ms` | `423.97 ms` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.40 MB | 1.00x | -3.37 KB | 1.00x |
| js-yaml | 95.07 MB | 1.04x | 181.74 KB | -53.97x |
| yaml | 100.23 MB | 1.10x | 593.41 KB | -176.23x |
| lightning-yaml | 95.14 MB | 1.04x | 87.45 KB | -25.97x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 87.18 MB | 1.00x | -6.58 KB | 1.00x |
| js-yaml | 95.31 MB | 1.09x | 187.09 KB | -28.44x |
| yaml | 93.21 MB | 1.07x | 235.15 KB | -35.75x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.78 MB | 1.00x | 172.83 KB | 1.00x |
| js-yaml | 107.44 MB | 1.11x | 573.31 KB | 3.32x |
| yaml | 174.54 MB | 1.80x | 1.23 MB | 7.31x |
| lightning-yaml | 96.89 MB | 1.00x | 456.95 KB | 2.64x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.32 MB | 1.00x | 98.70 KB | 1.00x |
| js-yaml | 117.29 MB | 1.22x | 484.13 KB | 4.91x |
| yaml | 143.84 MB | 1.49x | 515.69 KB | 5.23x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 120.80 MB | 1.00x | 1.95 MB | 1.00x |
| js-yaml | 272.33 MB | 2.25x | 3.37 MB | 1.73x |
| yaml | 520.66 MB | 4.31x | 4.24 MB | 2.17x |
| lightning-yaml | 129.19 MB | 1.07x | 3.25 MB | 1.67x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 110.99 MB | 1.00x | 1.13 MB | 1.00x |
| js-yaml | 287.94 MB | 2.59x | 1.13 MB | 0.99x |
| yaml | 271.89 MB | 2.45x | 533.09 KB | 0.46x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 278.45 MB | 1.00x | 17.43 MB | 1.00x |
| js-yaml | 985.69 MB | 3.54x | 26.81 MB | 1.54x |
| yaml | 3.31 GB | 12.19x | 39.83 MB | 2.29x |
| lightning-yaml | 362.87 MB | 1.30x | 27.78 MB | 1.59x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 297.21 MB | 1.00x | 10.23 MB | 1.00x |
| js-yaml | 1.15 GB | 3.97x | 15.99 MB | 1.56x |
| yaml | 658.16 MB | 2.21x | 10.18 MB | 1.00x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 94.22 MB | 1.00x | 227.25 KB | 1.00x |
| js-yaml | 143.14 MB | 1.52x | 549.24 KB | 2.42x |
| yaml | 211.84 MB | 2.25x | 1.15 MB | 5.17x |
| lightning-yaml | 95.86 MB | 1.02x | 430.28 KB | 1.89x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.70 MB | 1.00x | 161.63 KB | 1.00x |
| js-yaml | 130.36 MB | 1.35x | 543.75 KB | 3.36x |
| yaml | 151.25 MB | 1.56x | 631.62 KB | 3.91x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 115.66 MB | 1.00x | 1.63 MB | 1.00x |
| js-yaml | 255.94 MB | 2.21x | 2.11 MB | 1.30x |
| yaml | 484.26 MB | 4.19x | 2.02 MB | 1.24x |
| lightning-yaml | 132.00 MB | 1.14x | 1.99 MB | 1.22x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 110.96 MB | 1.00x | 1.19 MB | 1.00x |
| js-yaml | 289.48 MB | 2.61x | 1023.68 KB | 0.84x |
| yaml | 246.46 MB | 2.22x | 1.09 MB | 0.92x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 95.16 MB | — | 191.12 KB | — |
| yaml | 100.12 MB | — | 665.02 KB | — |
| lightning-yaml | 94.35 MB | — | 107.24 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 95.26 MB | 1.00x | -12.84 KB | 1.00x |
| js-yaml | 93.32 MB | 0.98x | 170.62 KB | -13.29x |
| yaml | 97.55 MB | 1.02x | 196.59 KB | -15.32x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 125.41 MB | — | 611.22 KB | — |
| yaml | 193.84 MB | — | 1.20 MB | — |
| lightning-yaml | 96.64 MB | — | 530.91 KB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 116.50 MB | 1.00x | 85.95 KB | 1.00x |
| js-yaml | 130.67 MB | 1.12x | 443.80 KB | 5.16x |
| yaml | 150.72 MB | 1.29x | 449.55 KB | 5.23x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 242.48 MB | — | 2.87 MB | — |
| yaml | 467.84 MB | — | 2.45 MB | — |
| lightning-yaml | 131.02 MB | — | 2.78 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 213.67 MB | 1.00x | 939.71 KB | 1.00x |
| js-yaml | 279.36 MB | 1.31x | 745.99 KB | 0.79x |
| yaml | 259.00 MB | 1.21x | 251.30 KB | 0.27x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 104.08 MB | — | 362.02 KB | — |
| yaml | 166.93 MB | — | 890.33 KB | — |
| lightning-yaml | 96.63 MB | — | 304.40 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 104.21 MB | 1.00x | 29.29 KB | 1.00x |
| js-yaml | 108.32 MB | 1.04x | 333.77 KB | 11.40x |
| yaml | 126.13 MB | 1.21x | 397.38 KB | 13.57x |

**parse · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| yaml | 96.77 MB | — | 737.40 KB | — |
| lightning-yaml | 91.21 MB | — | 166.27 KB | — |

**stringify · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 95.61 MB | — | 183.00 KB | — |
| yaml | 100.66 MB | — | 279.42 KB | — |

**parse · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| yaml | 184.85 MB | — | 1.29 MB | — |
| lightning-yaml | 99.73 MB | — | 625.17 KB | — |

**stringify · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 123.45 MB | — | 456.83 KB | — |
| yaml | 161.26 MB | — | 541.43 KB | — |

**parse · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| yaml | 338.31 MB | — | 1.42 MB | — |
| lightning-yaml | 130.36 MB | — | 2.35 MB | — |

**stringify · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 245.33 MB | — | 1.55 MB | — |
| yaml | 296.97 MB | — | 1.03 MB | — |
<!-- BENCH:COMPETITION:END -->

### Our implementation

<!-- BENCH:OURS:START -->
_Generated by `pnpm bench:self`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~1.55 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.80GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.80 µs/iter` | `  6.34 µs` | `  6.62 µs` | `  7.17 µs` | ` 10.99 µs` |
| lightning-yaml | ` 17.07 µs/iter` | ` 16.56 µs` | ` 17.09 µs` | ` 17.67 µs` | ` 18.06 µs` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `693.30 µs/iter` | `630.03 µs` | `696.46 µs` | `  1.16 ms` | `  1.63 ms` |
| lightning-yaml | `  1.67 ms/iter` | `  1.58 ms` | `  1.67 ms` | `  2.53 ms` | `  2.74 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  8.08 ms/iter` | `  7.60 ms` | `  7.85 ms` | ` 10.54 ms` | ` 10.57 ms` |
| lightning-yaml | ` 20.28 ms/iter` | ` 18.33 ms` | ` 22.09 ms` | ` 22.80 ms` | ` 23.10 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 92.04 ms/iter` | ` 86.61 ms` | ` 90.35 ms` | ` 94.82 ms` | `118.12 ms` |
| lightning-yaml | `202.91 ms/iter` | `192.75 ms` | `203.21 ms` | `214.56 ms` | `240.70 ms` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  1.41 ms/iter` | `  1.35 ms` | `  1.41 ms` | `  2.27 ms` | `  2.61 ms` |
| lightning-yaml | `  2.97 ms/iter` | `  2.88 ms` | `  2.95 ms` | `  3.81 ms` | `  4.05 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 10.17 ms/iter` | `  9.86 ms` | `  9.98 ms` | ` 12.63 ms` | ` 12.70 ms` |
| lightning-yaml | ` 22.27 ms/iter` | ` 21.26 ms` | ` 23.22 ms` | ` 24.54 ms` | ` 24.68 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 21.31 µs/iter` | ` 20.44 µs` | ` 20.89 µs` | ` 22.55 µs` | ` 25.40 µs` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  2.50 ms/iter` | `  2.40 ms` | `  2.50 ms` | `  3.44 ms` | `  3.55 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 25.33 ms/iter` | ` 24.45 ms` | ` 26.40 ms` | ` 26.92 ms` | ` 26.97 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  1.25 ms/iter` | `  1.20 ms` | `  1.26 ms` | `  1.52 ms` | `  2.01 ms` |

| • parse · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 28.85 µs/iter` | ` 28.43 µs` | ` 29.01 µs` | ` 29.28 µs` | ` 29.50 µs` |

| • parse · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  2.20 ms/iter` | `  2.06 ms` | `  2.15 ms` | `  3.55 ms` | `  3.91 ms` |

| • parse · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 20.84 ms/iter` | ` 20.05 ms` | ` 22.06 ms` | ` 22.36 ms` | ` 22.61 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  4.43 µs/iter` | `  4.35 µs` | `  4.46 µs` | `  4.54 µs` | `  4.58 µs` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `490.64 µs/iter` | `450.41 µs` | `494.93 µs` | `739.11 µs` | `  1.01 ms` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  6.49 ms/iter` | `  6.00 ms` | `  6.23 ms` | ` 11.64 ms` | ` 11.72 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | ` 61.25 ms/iter` | ` 60.10 ms` | ` 61.72 ms` | ` 62.48 ms` | ` 64.33 ms` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `953.71 µs/iter` | `818.34 µs` | `909.21 µs` | `  1.30 ms` | `  7.26 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  6.68 ms/iter` | `  6.23 ms` | `  6.45 ms` | ` 11.51 ms` | ` 11.62 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  3.51 µs/iter` | `  3.46 µs` | `  3.51 µs` | `  3.63 µs` | `  3.64 µs` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `460.49 µs/iter` | `423.90 µs` | `467.32 µs` | `547.81 µs` | `992.74 µs` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `  5.34 ms/iter` | `  4.89 ms` | `  5.07 ms` | ` 10.63 ms` | ` 10.68 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| ---- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON | `201.14 µs/iter` | `187.75 µs` | `209.71 µs` | `244.72 µs` | `679.87 µs` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.18 MB | 1.00x | -4.05 KB | 1.00x |
| lightning-yaml | 93.21 MB | 1.02x | 86.36 KB | -21.34x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.11 MB | 1.00x | -6.43 KB | 1.00x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.89 MB | 1.00x | 174.29 KB | 1.00x |
| lightning-yaml | 98.95 MB | 1.02x | 454.82 KB | 2.61x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 95.86 MB | 1.00x | 96.79 KB | 1.00x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 121.12 MB | 1.00x | 1.95 MB | 1.00x |
| lightning-yaml | 134.05 MB | 1.11x | 3.25 MB | 1.67x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 110.80 MB | 1.00x | 1.13 MB | 1.00x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 277.37 MB | 1.00x | 17.43 MB | 1.00x |
| lightning-yaml | 366.65 MB | 1.32x | 27.78 MB | 1.59x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 296.27 MB | 1.00x | 10.23 MB | 1.00x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 94.16 MB | 1.00x | 228.66 KB | 1.00x |
| lightning-yaml | 99.17 MB | 1.05x | 429.08 KB | 1.88x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.55 MB | 1.00x | 162.47 KB | 1.00x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 110.68 MB | 1.00x | 1.63 MB | 1.00x |
| lightning-yaml | 128.90 MB | 1.16x | 1.99 MB | 1.22x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 107.14 MB | 1.00x | 1.19 MB | 1.00x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 91.57 MB | — | 106.79 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 95.44 MB | 1.00x | -11.81 KB | 1.00x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 99.02 MB | — | 530.62 KB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 115.19 MB | 1.00x | 85.62 KB | 1.00x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 130.78 MB | — | 2.78 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 213.43 MB | 1.00x | 939.71 KB | 1.00x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 95.43 MB | — | 292.38 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 107.74 MB | 1.00x | 29.30 KB | 1.00x |

**parse · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 91.66 MB | — | 164.88 KB | — |

**parse · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 98.39 MB | — | 624.80 KB | — |

**parse · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 129.70 MB | — | 2.34 MB | — |
<!-- BENCH:OURS:END -->

## Layout

```
src/
  index.ts             # the parser — parse/parseAll (M0–M5); stringify still a stub
bench/
  candidates.ts        # candidates + groups + kind; applies/supports/handles gating
  oracle.ts            # the spec oracle (yaml) used by the fixtures + tests
  report.ts            # regenerate README blocks: `report.ts self|competition`
  conformance/         # yaml-test-suite runner (`test:suite`) + compat cross-checks
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
  consistency.test.ts  # ours vs. oracle over the benchmark data (fully green)
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
