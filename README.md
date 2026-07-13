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
multi-document streams, and explicit `? key`/`: value` block mappings.
`stringify` (milestone **M6**) is implemented too — a block-style dumper with
scalar quoting, `Uint8Array` → `!!binary`, and anchor/alias emission for shared
references and cycles, round-tripping through the oracle. Only merge keys
(`<<`) remain unimplemented — they aren't in the test corpus.

On the [yaml-test-suite](https://github.com/yaml/yaml-test-suite) — the
project's headline correctness result — lightning-yaml scores **364/373
(97.6%)**, ahead of **js-yaml v5.2.1 at 354/373 (94.9%)** and even the **`yaml`
oracle at 362/373 (97.1%)**, with **100% (91/91) on the negative/error cases**.
The 9 remaining misses are spec corners `yaml` itself also fails. Reproduce with
`pnpm test:suite` (runner: [`bench/conformance/`](bench/conformance/)).

On the repo's benchmarks it parses the JSON fixtures at **~0.50× `JSON.parse`**
and block YAML at **~39 MB/s**, **~4.4× faster than js-yaml** and **~39×
faster than `yaml`**, with peak RSS **~1.3× `JSON.parse`** on the 10 MB fixture
(see the head-to-head below). `stringify` — implemented in M6, tuned for
throughput in M7 — runs at **~5.1× `JSON.stringify`** on record data, with
lower peak RSS than either competitor library. The benchmarks and
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

| name           | group       | kind | parse                    | stringify             |
| -------------- | ----------- | ---- | ------------------------ | ---------------------- |
| JSON           | baseline    | json | `JSON.parse`             | `JSON.stringify`       |
| js-yaml        | competition | yaml | `load`                   | `dump`                 |
| yaml           | competition | yaml | `parse`                  | `stringify`            |
| lightning-yaml | ours        | yaml | `src/index.ts` _(M0–M5)_ | `src/index.ts` _(M6)_  |

`lightning-yaml` (group `ours`) is wired to [`src/index.ts`](src/index.ts). Its
`parse` covers the full YAML 1.2 core feature set — flow/block syntax, block
scalars, anchors/aliases, tags including `!!binary`, directives, and
multi-document streams. `stringify` (milestone **M6**, tuned for throughput in
**M7**) is implemented too — a block-style dumper with scalar quoting,
`Uint8Array` → `!!binary`, and anchor/alias emission for shared references and
cycles — so it now runs in the stringify benches/tests rather than being
skipped. `Candidate.stringify` stays optional in the registry (for a
hypothetical future candidate that can't dump), and we still never substitute
a foreign serializer for one that lacks it — but today every candidate,
including ours, provides one. A per-fixture capability probe
(`candidateHandles`) benchmarks it only on inputs it can read today — now the
JSON, block `yaml-plain`, **and** anchor/`!!binary` `yaml-rich` rows for both
`parse` and `stringify`, since both ops handle all three categories. Each
candidate's `kind` (`json` vs. `yaml`) decides which data categories it runs
on.

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
  `lightning-yaml.parse(text)` must deep-equal `oracle.parse(text)`, and — now
  that the dumper is implemented (M6; see also
  [`test/stringify.unit.ts`](test/stringify.unit.ts), `pnpm test:stringify`,
  **217/217 passing**) — `oracle.parse(lightning-yaml.stringify(value))` must
  deep-equal `value` too; we still don't substitute a foreign serializer for a
  candidate that lacks one. Rich fixtures additionally assert that
  `&anchor`/`*alias` reuse is reconstructed as **shared references**, not deep
  copies. Today the suite is **fully green** across all three categories — JSON,
  block `yaml-plain`, and `yaml-rich` alike, both parse and the now-active
  stringify round-trip; it stayed red on `yaml-rich` parse only until anchors +
  `!!binary` landed, and on the stringify round-trip only until the dumper (M6)
  landed.
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
handle that fixture/op — e.g. `JSON.parse` can't read block
`yaml-plain`/`yaml-rich` fixtures at all (though it still appears as a
stringify baseline on JSON-compatible `yaml-plain` data). `lightning-yaml` now
both parses and stringifies all three categories, including anchor/`!!binary`
`yaml-rich`, so it appears on every parse **and** stringify row alongside the
competition. Refreshed by the slow `bench:competition` run; the fast
per-commit tracker for our parser alone is the "Our implementation" block
below.

<!-- BENCH:COMPETITION:START -->
_Generated by `pnpm bench:competition`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~1.53 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.80GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.75 µs/iter` | `  6.38 µs` | `  6.84 µs` | `  7.34 µs` | `  7.66 µs` |
| js-yaml        | ` 65.85 µs/iter` | ` 49.26 µs` | ` 65.87 µs` | `171.74 µs` | `829.22 µs` |
| yaml           | `680.49 µs/iter` | `514.66 µs` | `663.96 µs` | `  1.51 ms` | `  1.99 ms` |
| lightning-yaml | ` 15.64 µs/iter` | ` 15.10 µs` | ` 15.91 µs` | ` 16.02 µs` | ` 16.30 µs` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `766.78 µs/iter` | `640.49 µs` | `770.34 µs` | `  1.36 ms` | `  1.90 ms` |
| js-yaml        | `  6.57 ms/iter` | `  5.59 ms` | `  7.61 ms` | `  8.58 ms` | `  9.07 ms` |
| yaml           | ` 82.96 ms/iter` | ` 74.24 ms` | ` 82.92 ms` | ` 98.01 ms` | `108.20 ms` |
| lightning-yaml | `  1.54 ms/iter` | `  1.39 ms` | `  1.56 ms` | `  2.56 ms` | `  2.71 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  8.56 ms/iter` | `  7.78 ms` | `  8.58 ms` | ` 11.29 ms` | ` 11.69 ms` |
| js-yaml        | `104.18 ms/iter` | ` 92.43 ms` | `104.74 ms` | `120.32 ms` | `129.28 ms` |
| yaml           | `964.01 ms/iter` | `859.44 ms` | `   1.01 s` | `   1.09 s` | `   1.11 s` |
| lightning-yaml | ` 19.19 ms/iter` | ` 16.40 ms` | ` 20.84 ms` | ` 24.28 ms` | ` 26.60 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 97.52 ms/iter` | ` 89.18 ms` | ` 95.50 ms` | `116.08 ms` | `125.90 ms` |
| js-yaml        | `997.99 ms/iter` | `860.77 ms` | `   1.06 s` | `   1.17 s` | `   1.26 s` |
| yaml           | `   9.89 s/iter` | `   8.71 s` | `   9.99 s` | `  11.33 s` | `  13.99 s` |
| lightning-yaml | `196.25 ms/iter` | `177.66 ms` | `192.63 ms` | `232.06 ms` | `235.68 ms` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  1.51 ms/iter` | `  1.36 ms` | `  1.54 ms` | `  2.48 ms` | `  2.78 ms` |
| js-yaml        | ` 11.81 ms/iter` | `  9.74 ms` | ` 13.03 ms` | ` 15.28 ms` | ` 15.50 ms` |
| yaml           | `130.00 ms/iter` | `121.68 ms` | `129.75 ms` | `143.63 ms` | `151.34 ms` |
| lightning-yaml | `  2.94 ms/iter` | `  2.71 ms` | `  2.97 ms` | `  3.96 ms` | `  4.26 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 10.92 ms/iter` | ` 10.30 ms` | ` 10.90 ms` | ` 13.15 ms` | ` 13.17 ms` |
| js-yaml        | `112.47 ms/iter` | ` 98.43 ms` | `113.47 ms` | `135.62 ms` | `152.38 ms` |
| yaml           | `930.87 ms/iter` | `875.45 ms` | `957.17 ms` | `975.34 ms` | `   1.01 s` |
| lightning-yaml | ` 22.24 ms/iter` | ` 20.00 ms` | ` 22.62 ms` | ` 25.01 ms` | ` 34.82 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | ` 65.92 µs/iter` | ` 53.64 µs` | ` 63.80 µs` | `165.25 µs` | `632.01 µs` |
| yaml           | `748.84 µs/iter` | `574.84 µs` | `736.33 µs` | `  1.74 ms` | `  2.13 ms` |
| lightning-yaml | ` 20.29 µs/iter` | ` 19.78 µs` | ` 20.44 µs` | ` 21.26 µs` | ` 21.45 µs` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  7.78 ms/iter` | `  7.05 ms` | `  8.30 ms` | ` 10.36 ms` | ` 10.62 ms` |
| yaml           | `103.36 ms/iter` | ` 94.21 ms` | `106.11 ms` | `110.25 ms` | `132.21 ms` |
| lightning-yaml | `  2.44 ms/iter` | `  2.25 ms` | `  2.45 ms` | `  3.55 ms` | `  3.92 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `111.95 ms/iter` | ` 96.10 ms` | `115.93 ms` | `122.23 ms` | `147.58 ms` |
| yaml           | `   1.01 s/iter` | `953.83 ms` | `   1.06 s` | `   1.08 s` | `   1.08 s` |
| lightning-yaml | ` 25.72 ms/iter` | ` 23.24 ms` | ` 27.00 ms` | ` 29.19 ms` | ` 30.33 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  3.82 ms/iter` | `  3.36 ms` | `  4.03 ms` | `  5.39 ms` | `  5.78 ms` |
| yaml           | ` 59.35 ms/iter` | ` 42.04 ms` | ` 68.50 ms` | ` 75.63 ms` | `124.21 ms` |
| lightning-yaml | `  1.33 ms/iter` | `  1.20 ms` | `  1.33 ms` | `  2.09 ms` | `  2.22 ms` |

| • parse · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| yaml           | `  1.04 ms/iter` | `819.33 µs` | `  1.02 ms` | `  2.12 ms` | `  2.63 ms` |
| lightning-yaml | ` 30.19 µs/iter` | ` 29.78 µs` | ` 30.21 µs` | ` 30.29 µs` | ` 32.01 µs` |

| • parse · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| yaml           | ` 85.33 ms/iter` | ` 76.75 ms` | ` 83.25 ms` | ` 90.83 ms` | `122.72 ms` |
| lightning-yaml | `  2.36 ms/iter` | `  2.05 ms` | `  2.41 ms` | `  3.35 ms` | `  3.47 ms` |

| • parse · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| yaml           | `   1.18 s/iter` | `   1.12 s` | `   1.20 s` | `   1.21 s` | `   1.36 s` |
| lightning-yaml | ` 21.16 ms/iter` | ` 19.93 ms` | ` 22.16 ms` | ` 23.37 ms` | ` 23.60 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  4.48 µs/iter` | `  4.41 µs` | `  4.54 µs` | `  4.60 µs` | `  4.64 µs` |
| js-yaml        | `130.45 µs/iter` | `103.08 µs` | `137.85 µs` | `271.48 µs` | `  1.03 ms` |
| yaml           | `368.33 µs/iter` | `281.39 µs` | `361.98 µs` | `  1.94 ms` | `  2.48 ms` |
| lightning-yaml | ` 18.75 µs/iter` | ` 17.79 µs` | ` 18.78 µs` | ` 19.89 µs` | ` 20.87 µs` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `529.17 µs/iter` | `462.56 µs` | `541.99 µs` | `759.99 µs` | `  1.13 ms` |
| js-yaml        | ` 15.46 ms/iter` | ` 13.46 ms` | ` 16.17 ms` | ` 19.17 ms` | ` 19.24 ms` |
| yaml           | ` 41.02 ms/iter` | ` 38.34 ms` | ` 43.89 ms` | ` 45.86 ms` | ` 46.63 ms` |
| lightning-yaml | `  2.42 ms/iter` | `  2.11 ms` | `  2.39 ms` | `  4.12 ms` | `  4.18 ms` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  7.43 ms/iter` | `  6.30 ms` | `  7.08 ms` | ` 13.66 ms` | ` 13.76 ms` |
| js-yaml        | `201.88 ms/iter` | `188.56 ms` | `199.71 ms` | `207.17 ms` | `251.16 ms` |
| yaml           | `443.16 ms/iter` | `421.60 ms` | `451.91 ms` | `468.75 ms` | `490.53 ms` |
| lightning-yaml | ` 35.60 ms/iter` | ` 33.40 ms` | ` 36.51 ms` | ` 37.46 ms` | ` 37.81 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 66.92 ms/iter` | ` 64.30 ms` | ` 68.65 ms` | ` 69.09 ms` | ` 72.75 ms` |
| js-yaml        | `   1.90 s/iter` | `   1.75 s` | `   1.93 s` | `   2.09 s` | `   2.11 s` |
| yaml           | `   4.06 s/iter` | `   3.94 s` | `   4.09 s` | `   4.13 s` | `   4.23 s` |
| lightning-yaml | `538.88 ms/iter` | `482.06 ms` | `552.06 ms` | `581.85 ms` | `621.49 ms` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `945.57 µs/iter` | `858.83 µs` | `951.17 µs` | `  1.14 ms` | `  2.86 ms` |
| js-yaml        | ` 24.18 ms/iter` | ` 22.40 ms` | ` 24.90 ms` | ` 26.96 ms` | ` 29.47 ms` |
| yaml           | ` 64.68 ms/iter` | ` 59.31 ms` | ` 63.38 ms` | ` 72.84 ms` | ` 89.24 ms` |
| lightning-yaml | `  4.06 ms/iter` | `  3.54 ms` | `  3.97 ms` | `  5.81 ms` | `  6.02 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  7.04 ms/iter` | `  6.51 ms` | `  7.25 ms` | `  8.53 ms` | `  8.59 ms` |
| js-yaml        | `197.52 ms/iter` | `191.58 ms` | `199.24 ms` | `201.49 ms` | `208.01 ms` |
| yaml           | `483.46 ms/iter` | `441.35 ms` | `473.93 ms` | `502.39 ms` | `627.13 ms` |
| lightning-yaml | ` 36.96 ms/iter` | ` 31.99 ms` | ` 42.75 ms` | ` 43.59 ms` | ` 45.16 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  3.63 µs/iter` | `  3.50 µs` | `  3.68 µs` | `  3.88 µs` | `  3.89 µs` |
| js-yaml        | ` 95.61 µs/iter` | ` 78.75 µs` | ` 95.01 µs` | `196.19 µs` | `936.04 µs` |
| yaml           | `274.60 µs/iter` | `210.52 µs` | `273.01 µs` | `  1.11 ms` | `  2.80 ms` |
| lightning-yaml | ` 13.96 µs/iter` | ` 13.88 µs` | ` 13.99 µs` | ` 14.06 µs` | ` 14.08 µs` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `462.45 µs/iter` | `420.48 µs` | `466.69 µs` | `765.04 µs` | `  1.07 ms` |
| js-yaml        | ` 12.52 ms/iter` | ` 11.52 ms` | ` 13.10 ms` | ` 13.82 ms` | ` 13.97 ms` |
| yaml           | ` 34.65 ms/iter` | ` 33.04 ms` | ` 35.49 ms` | ` 37.42 ms` | ` 38.09 ms` |
| lightning-yaml | `  2.09 ms/iter` | `  1.88 ms` | `  2.02 ms` | `  3.55 ms` | `  4.10 ms` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  5.58 ms/iter` | `  5.13 ms` | `  5.69 ms` | `  6.61 ms` | `  6.83 ms` |
| js-yaml        | `163.48 ms/iter` | `147.73 ms` | `164.33 ms` | `185.59 ms` | `208.33 ms` |
| yaml           | `361.04 ms/iter` | `339.96 ms` | `360.90 ms` | `381.57 ms` | `394.36 ms` |
| lightning-yaml | ` 34.18 ms/iter` | ` 30.47 ms` | ` 35.60 ms` | ` 35.76 ms` | ` 35.83 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `220.20 µs/iter` | `189.53 µs` | `228.67 µs` | `368.64 µs` | `887.95 µs` |
| js-yaml        | `  5.72 ms/iter` | `  5.00 ms` | `  6.24 ms` | `  8.18 ms` | `  8.27 ms` |
| yaml           | ` 15.19 ms/iter` | ` 13.60 ms` | ` 15.63 ms` | ` 19.09 ms` | ` 20.88 ms` |
| lightning-yaml | `876.43 µs/iter` | `753.44 µs` | `851.27 µs` | `  1.91 ms` | `  2.30 ms` |

| • stringify · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `114.99 µs/iter` | ` 98.83 µs` | `110.95 µs` | `241.40 µs` | `919.93 µs` |
| yaml           | `521.12 µs/iter` | `396.35 µs` | `512.61 µs` | `  1.93 ms` | `  2.38 ms` |
| lightning-yaml | ` 23.21 µs/iter` | ` 22.27 µs` | ` 23.42 µs` | ` 23.75 µs` | ` 24.24 µs` |

| • stringify · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `  9.69 ms/iter` | `  8.60 ms` | ` 10.39 ms` | ` 12.00 ms` | ` 12.02 ms` |
| yaml           | ` 45.84 ms/iter` | ` 40.87 ms` | ` 46.54 ms` | ` 50.64 ms` | ` 51.41 ms` |
| lightning-yaml | `  2.35 ms/iter` | `  1.99 ms` | `  2.24 ms` | `  4.00 ms` | `  4.22 ms` |

| • stringify · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| js-yaml        | `113.25 ms/iter` | `103.03 ms` | `117.31 ms` | `121.44 ms` | `140.13 ms` |
| yaml           | `414.84 ms/iter` | `393.81 ms` | `416.66 ms` | `438.11 ms` | `438.72 ms` |
| lightning-yaml | ` 30.01 ms/iter` | ` 27.63 ms` | ` 31.19 ms` | ` 31.41 ms` | ` 31.57 ms` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.18 MB | 1.00x | -2.88 KB | 1.00x |
| js-yaml | 95.48 MB | 1.05x | 182.18 KB | -63.37x |
| yaml | 101.26 MB | 1.11x | 595.05 KB | -206.98x |
| lightning-yaml | 92.92 MB | 1.02x | 87.48 KB | -30.43x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.66 MB | 1.00x | -5.74 KB | 1.00x |
| js-yaml | 92.25 MB | 1.01x | 177.09 KB | -30.84x |
| yaml | 94.51 MB | 1.03x | 235.85 KB | -41.07x |
| lightning-yaml | 95.34 MB | 1.04x | 30.80 KB | -5.36x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 98.02 MB | 1.00x | 173.86 KB | 1.00x |
| js-yaml | 109.70 MB | 1.12x | 570.90 KB | 3.28x |
| yaml | 172.65 MB | 1.76x | 1.23 MB | 7.25x |
| lightning-yaml | 96.05 MB | 0.98x | 464.53 KB | 2.67x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 93.72 MB | 1.00x | 96.54 KB | 1.00x |
| js-yaml | 125.76 MB | 1.34x | 463.01 KB | 4.80x |
| yaml | 141.36 MB | 1.51x | 516.32 KB | 5.35x |
| lightning-yaml | 104.28 MB | 1.11x | 217.98 KB | 2.26x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 122.73 MB | 1.00x | 1.95 MB | 1.00x |
| js-yaml | 261.80 MB | 2.13x | 3.37 MB | 1.73x |
| yaml | 526.25 MB | 4.29x | 4.25 MB | 2.18x |
| lightning-yaml | 135.93 MB | 1.11x | 3.27 MB | 1.68x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 105.65 MB | 1.00x | 1.14 MB | 1.00x |
| js-yaml | 276.49 MB | 2.62x | 1.14 MB | 1.01x |
| yaml | 268.47 MB | 2.54x | 533.32 KB | 0.46x |
| lightning-yaml | 160.86 MB | 1.52x | 1.33 MB | 1.17x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 284.16 MB | 1.00x | 17.43 MB | 1.00x |
| js-yaml | 974.90 MB | 3.43x | 26.81 MB | 1.54x |
| yaml | 2.68 GB | 9.64x | 39.83 MB | 2.29x |
| lightning-yaml | 368.52 MB | 1.30x | 27.80 MB | 1.59x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 301.12 MB | 1.00x | 10.23 MB | 1.00x |
| js-yaml | 1.14 GB | 3.88x | 16.02 MB | 1.57x |
| yaml | 985.20 MB | 3.27x | 10.19 MB | 1.00x |
| lightning-yaml | 566.65 MB | 1.88x | 10.00 MB | 0.98x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 93.95 MB | 1.00x | 228.03 KB | 1.00x |
| js-yaml | 138.71 MB | 1.48x | 551.57 KB | 2.42x |
| yaml | 215.07 MB | 2.29x | 1.13 MB | 5.09x |
| lightning-yaml | 100.46 MB | 1.07x | 415.79 KB | 1.82x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.98 MB | 1.00x | 162.86 KB | 1.00x |
| js-yaml | 130.93 MB | 1.35x | 537.88 KB | 3.30x |
| yaml | 157.21 MB | 1.62x | 633.61 KB | 3.89x |
| lightning-yaml | 107.30 MB | 1.11x | 358.46 KB | 2.20x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 113.27 MB | 1.00x | 1.63 MB | 1.00x |
| js-yaml | 257.28 MB | 2.27x | 2.11 MB | 1.30x |
| yaml | 508.02 MB | 4.49x | 2.01 MB | 1.24x |
| lightning-yaml | 131.50 MB | 1.16x | 2.01 MB | 1.23x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 107.75 MB | 1.00x | 1.19 MB | 1.00x |
| js-yaml | 292.24 MB | 2.71x | 1022.70 KB | 0.84x |
| yaml | 256.79 MB | 2.38x | 2.18 MB | 1.84x |
| lightning-yaml | 176.06 MB | 1.63x | 1.91 MB | 1.61x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 93.96 MB | — | 192.77 KB | — |
| yaml | 98.44 MB | — | 665.54 KB | — |
| lightning-yaml | 95.42 MB | — | 108.57 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 88.93 MB | 1.00x | -12.02 KB | 1.00x |
| js-yaml | 92.91 MB | 1.04x | 168.67 KB | -14.03x |
| yaml | 94.66 MB | 1.06x | 198.02 KB | -16.47x |
| lightning-yaml | 92.36 MB | 1.04x | 23.02 KB | -1.91x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 123.63 MB | — | 612.05 KB | — |
| yaml | 183.82 MB | — | 1.21 MB | — |
| lightning-yaml | 99.51 MB | — | 545.17 KB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 117.04 MB | 1.00x | 88.45 KB | 1.00x |
| js-yaml | 128.29 MB | 1.10x | 448.86 KB | 5.07x |
| yaml | 154.62 MB | 1.32x | 426.90 KB | 4.83x |
| lightning-yaml | 126.19 MB | 1.08x | 204.42 KB | 2.31x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 242.75 MB | — | 2.86 MB | — |
| yaml | 472.95 MB | — | 2.45 MB | — |
| lightning-yaml | 131.39 MB | — | 2.80 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 214.51 MB | 1.00x | 939.73 KB | 1.00x |
| js-yaml | 258.90 MB | 1.21x | 791.79 KB | 0.84x |
| yaml | 258.86 MB | 1.21x | 253.80 KB | 0.27x |
| lightning-yaml | 224.01 MB | 1.04x | 1.09 MB | 1.19x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 108.39 MB | — | 393.86 KB | — |
| yaml | 164.25 MB | — | 894.79 KB | — |
| lightning-yaml | 95.32 MB | — | 309.69 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 105.92 MB | 1.00x | 29.80 KB | 1.00x |
| js-yaml | 114.68 MB | 1.08x | 333.69 KB | 11.20x |
| yaml | 119.48 MB | 1.13x | 397.88 KB | 13.35x |
| lightning-yaml | 105.95 MB | 1.00x | 161.97 KB | 5.43x |

**parse · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| yaml | 102.24 MB | — | 736.93 KB | — |
| lightning-yaml | 90.50 MB | — | 172.38 KB | — |

**stringify · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 97.15 MB | — | 172.55 KB | — |
| yaml | 101.64 MB | — | 285.45 KB | — |
| lightning-yaml | 96.09 MB | — | 30.66 KB | — |

**parse · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| yaml | 189.63 MB | — | 1.29 MB | — |
| lightning-yaml | 99.97 MB | — | 636.87 KB | — |

**stringify · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 129.31 MB | — | 457.98 KB | — |
| yaml | 157.76 MB | — | 546.98 KB | — |
| lightning-yaml | 120.76 MB | — | 228.29 KB | — |

**parse · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| yaml | 355.31 MB | — | 1.43 MB | — |
| lightning-yaml | 127.45 MB | — | 2.36 MB | — |

**stringify · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| js-yaml | 242.21 MB | — | 1.65 MB | — |
| yaml | 297.98 MB | — | 1.02 MB | — |
| lightning-yaml | 205.77 MB | — | 923.41 KB | — |
<!-- BENCH:COMPETITION:END -->

### Our implementation

> **This block tracks our parser alone.** It's regenerated every commit by `pnpm bench:self`,
> which — for speed — benchmarks only `lightning-yaml` plus the `JSON` baseline (no competitors),
> so these tables intentionally have no `js-yaml`/`yaml` rows. For **stringify and parse numbers
> side-by-side with `js-yaml` and `yaml`**, see the
> [All parsers — head-to-head](#all-parsers--head-to-head) block above — where our stringify runs
> faster than both competitors across every category.

<!-- BENCH:OURS:START -->

_Generated by `pnpm bench:self`. Representative snapshot — timings drift run-to-run; peak-RSS/heap-Δ are the stable figures._

```
clk: ~1.56 GHz
cpu: Intel(R) Xeon(R) Processor @ 2.80GHz
runtime: node 22.22.2 (x64-linux)
```

### Speed — parse (mitata, sequential)

| • parse · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.51 µs/iter` | `  6.26 µs` | `  6.48 µs` | `  7.00 µs` | `  7.99 µs` |
| lightning-yaml | ` 16.56 µs/iter` | ` 15.41 µs` | ` 16.34 µs` | ` 17.67 µs` | ` 23.20 µs` |

| • parse · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `694.51 µs/iter` | `633.73 µs` | `701.89 µs` | `  1.03 ms` | `  1.59 ms` |
| lightning-yaml | `  1.57 ms/iter` | `  1.43 ms` | `  1.52 ms` | `  2.76 ms` | `  2.83 ms` |

| • parse · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  8.25 ms/iter` | `  7.61 ms` | `  8.30 ms` | ` 10.21 ms` | ` 10.30 ms` |
| lightning-yaml | ` 18.73 ms/iter` | ` 16.81 ms` | ` 20.05 ms` | ` 20.91 ms` | ` 21.65 ms` |

| • parse · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 91.73 ms/iter` | ` 87.16 ms` | ` 90.87 ms` | ` 92.71 ms` | `109.20 ms` |
| lightning-yaml | `185.35 ms/iter` | `176.84 ms` | `184.99 ms` | `186.54 ms` | `215.69 ms` |

| • parse · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  1.44 ms/iter` | `  1.35 ms` | `  1.43 ms` | `  2.34 ms` | `  2.47 ms` |
| lightning-yaml | `  2.90 ms/iter` | `  2.72 ms` | `  2.86 ms` | `  4.09 ms` | `  4.26 ms` |

| • parse · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 10.98 ms/iter` | ` 10.15 ms` | ` 11.34 ms` | ` 13.17 ms` | ` 13.32 ms` |
| lightning-yaml | ` 22.66 ms/iter` | ` 20.67 ms` | ` 23.54 ms` | ` 25.60 ms` | ` 26.39 ms` |

| • parse · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 20.51 µs/iter` | ` 20.03 µs` | ` 20.58 µs` | ` 20.80 µs` | ` 20.97 µs` |

| • parse · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  2.45 ms/iter` | `  2.28 ms` | `  2.38 ms` | `  4.31 ms` | `  4.35 ms` |

| • parse · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 24.10 ms/iter` | ` 23.14 ms` | ` 25.05 ms` | ` 25.82 ms` | ` 25.87 ms` |

| • parse · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  1.26 ms/iter` | `  1.20 ms` | `  1.27 ms` | `  1.70 ms` | `  2.06 ms` |

| • parse · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 31.99 µs/iter` | ` 30.37 µs` | ` 31.18 µs` | ` 32.15 µs` | ` 42.75 µs` |

| • parse · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  2.36 ms/iter` | `  2.12 ms` | `  2.26 ms` | `  3.99 ms` | `  4.04 ms` |

| • parse · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 22.50 ms/iter` | ` 21.00 ms` | ` 23.56 ms` | ` 25.74 ms` | ` 25.82 ms` |

### Speed — stringify (mitata, sequential)

| • stringify · small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  4.78 µs/iter` | `  4.39 µs` | `  4.87 µs` | `  5.54 µs` | `  6.40 µs` |
| lightning-yaml | ` 20.42 µs/iter` | ` 17.76 µs` | ` 21.91 µs` | ` 22.52 µs` | ` 25.32 µs` |

| • stringify · medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `512.71 µs/iter` | `451.91 µs` | `522.02 µs` | `905.69 µs` | `  1.13 ms` |
| lightning-yaml | `  2.43 ms/iter` | `  2.06 ms` | `  2.36 ms` | `  3.88 ms` | `  4.39 ms` |

| • stringify · large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.50 ms/iter` | `  6.12 ms` | `  6.57 ms` | `  7.44 ms` | `  7.75 ms` |
| lightning-yaml | ` 33.24 ms/iter` | ` 32.21 ms` | ` 33.43 ms` | ` 34.07 ms` | ` 34.32 ms` |

| • stringify · xlarge-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | ` 63.36 ms/iter` | ` 59.36 ms` | ` 61.78 ms` | ` 65.42 ms` | ` 89.20 ms` |
| lightning-yaml | `543.92 ms/iter` | `487.16 ms` | `574.13 ms` | `605.03 ms` | `666.52 ms` |

| • stringify · medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `938.80 µs/iter` | `854.79 µs` | `940.02 µs` | `  1.44 ms` | `  2.61 ms` |
| lightning-yaml | `  3.84 ms/iter` | `  3.43 ms` | `  3.75 ms` | `  5.28 ms` | `  5.33 ms` |

| • stringify · large-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  6.76 ms/iter` | `  6.47 ms` | `  6.74 ms` | `  7.99 ms` | `  8.44 ms` |
| lightning-yaml | ` 35.79 ms/iter` | ` 30.75 ms` | ` 41.81 ms` | ` 42.44 ms` | ` 42.51 ms` |

| • stringify · yaml-plain-small-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  3.50 µs/iter` | `  3.43 µs` | `  3.53 µs` | `  3.69 µs` | `  3.69 µs` |
| lightning-yaml | ` 13.93 µs/iter` | ` 13.82 µs` | ` 13.99 µs` | ` 13.99 µs` | ` 14.01 µs` |

| • stringify · yaml-plain-medium-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `463.43 µs/iter` | `420.02 µs` | `471.87 µs` | `744.04 µs` | `  1.02 ms` |
| lightning-yaml | `  2.16 ms/iter` | `  1.88 ms` | `  2.14 ms` | `  3.46 ms` | `  3.97 ms` |

| • stringify · yaml-plain-large-records |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `  5.26 ms/iter` | `  4.95 ms` | `  5.31 ms` | `  6.35 ms` | `  6.38 ms` |
| lightning-yaml | ` 28.38 ms/iter` | ` 26.51 ms` | ` 28.81 ms` | ` 29.42 ms` | ` 29.68 ms` |

| • stringify · yaml-plain-medium-nested |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| JSON           | `204.45 µs/iter` | `188.25 µs` | `212.03 µs` | `307.88 µs` | `699.20 µs` |
| lightning-yaml | `888.31 µs/iter` | `768.66 µs` | `874.72 µs` | `  1.69 ms` | `  1.75 ms` |

| • stringify · yaml-rich-small |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 22.54 µs/iter` | ` 22.30 µs` | ` 22.67 µs` | ` 22.72 µs` | ` 22.91 µs` |

| • stringify · yaml-rich-medium |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | `  2.18 ms/iter` | `  1.93 ms` | `  2.11 ms` | `  3.37 ms` | `  3.54 ms` |

| • stringify · yaml-rich-large |              avg |         min |         p75 |         p99 |         max |
| -------------- | ---------------- | ----------- | ----------- | ----------- | ----------- |
| lightning-yaml | ` 25.44 ms/iter` | ` 23.79 ms` | ` 26.03 ms` | ` 26.63 ms` | ` 27.19 ms` |

### Peak memory (isolated processes, sequential)

**parse · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 91.57 MB | 1.00x | -3.47 KB | 1.00x |
| lightning-yaml | 93.32 MB | 1.02x | 87.75 KB | -25.30x |

**stringify · small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 95.54 MB | 1.00x | -5.22 KB | 1.00x |
| lightning-yaml | 91.98 MB | 0.96x | 30.42 KB | -5.83x |

**parse · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 97.59 MB | 1.00x | 173.61 KB | 1.00x |
| lightning-yaml | 100.10 MB | 1.03x | 464.08 KB | 2.67x |

**stringify · medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.65 MB | 1.00x | 97.38 KB | 1.00x |
| lightning-yaml | 104.42 MB | 1.08x | 223.35 KB | 2.29x |

**parse · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 126.08 MB | 1.00x | 1.95 MB | 1.00x |
| lightning-yaml | 134.30 MB | 1.07x | 3.26 MB | 1.67x |

**stringify · large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 109.29 MB | 1.00x | 1.14 MB | 1.00x |
| lightning-yaml | 163.30 MB | 1.49x | 1.33 MB | 1.17x |

**parse · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 280.46 MB | 1.00x | 17.43 MB | 1.00x |
| lightning-yaml | 369.09 MB | 1.32x | 27.80 MB | 1.59x |

**stringify · xlarge-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 297.25 MB | 1.00x | 10.23 MB | 1.00x |
| lightning-yaml | 601.11 MB | 2.02x | 9.98 MB | 0.98x |

**parse · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 92.61 MB | 1.00x | 228.20 KB | 1.00x |
| lightning-yaml | 98.21 MB | 1.06x | 436.59 KB | 1.91x |

**stringify · medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.91 MB | 1.00x | 163.33 KB | 1.00x |
| lightning-yaml | 111.80 MB | 1.15x | 361.40 KB | 2.21x |

**parse · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 111.63 MB | 1.00x | 1.63 MB | 1.00x |
| lightning-yaml | 132.04 MB | 1.18x | 2.01 MB | 1.23x |

**stringify · large-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 106.11 MB | 1.00x | 1.19 MB | 1.00x |
| lightning-yaml | 178.64 MB | 1.68x | 1.91 MB | 1.61x |

**parse · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 92.19 MB | — | 108.43 KB | — |

**stringify · yaml-plain-small-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 96.36 MB | 1.00x | -9.70 KB | 1.00x |
| lightning-yaml | 96.08 MB | 1.00x | 22.86 KB | -2.36x |

**parse · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 97.12 MB | — | 546.25 KB | — |

**stringify · yaml-plain-medium-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 116.14 MB | 1.00x | 88.45 KB | 1.00x |
| lightning-yaml | 128.15 MB | 1.10x | 202.16 KB | 2.29x |

**parse · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 131.20 MB | — | 2.80 MB | — |

**stringify · yaml-plain-large-records**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 214.25 MB | 1.00x | 939.73 KB | 1.00x |
| lightning-yaml | 223.03 MB | 1.04x | 1.09 MB | 1.19x |

**parse · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 98.65 MB | — | 325.80 KB | — |

**stringify · yaml-plain-medium-nested**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| JSON | 109.17 MB | 1.00x | 29.80 KB | 1.00x |
| lightning-yaml | 104.97 MB | 0.96x | 159.66 KB | 5.36x |

**parse · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 95.22 MB | — | 176.32 KB | — |

**stringify · yaml-rich-small**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 95.51 MB | — | 29.37 KB | — |

**parse · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 98.38 MB | — | 638.08 KB | — |

**stringify · yaml-rich-medium**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 121.82 MB | — | 233.16 KB | — |

**parse · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 133.02 MB | — | 2.36 MB | — |

**stringify · yaml-rich-large**

| candidate | peak RSS | vs JSON | heap Δ | vs JSON |
| --- | ---: | ---: | ---: | ---: |
| lightning-yaml | 201.29 MB | — | 923.38 KB | — |
<!-- BENCH:OURS:END -->

### Bundle size

How many kilobytes each parser adds to a **browser** bundle when an app imports only
`parse` + `stringify` and ships it minified — the third axis alongside speed and memory.
Every library is bundled by **five real bundlers** (Vite, Webpack, Bun, Deno, Rolldown),
each with **tree-shaking on** and **true minification** (whitespace + comments stripped,
identifiers mangled), resolving each library's **ESM** build. Sizes are deterministic, so
these figures are committed; refresh with `pnpm bench:bundlesize`. Method + rationale:
[`bench/bundlesize`](bench/bundlesize/).

<!-- BENCH:BUNDLESIZE:START -->
_Generated by `pnpm bench:bundlesize`. Entry imports only `parse` + `stringify`;
bundled for the browser with tree-shaking + minification (identifier mangling).
Sizes are deterministic. Lower is better._

| Library | Bundler | Minified | Gzip | Brotli |
| --- | --- | ---: | ---: | ---: |
| **lightning-yaml** | vite | 40.15 KB | 12.00 KB | 10.52 KB |
|  | webpack | 39.95 KB | 11.93 KB | 10.46 KB |
|  | rolldown _(rust)_ | 39.78 KB | 11.54 KB | 10.15 KB |
|  | bun | 41.33 KB | 12.06 KB | 10.44 KB |
|  | deno _(rust)_ | 40.08 KB | 11.89 KB | 10.46 KB |
| **yaml** | vite | 96.50 KB | 29.36 KB | 26.43 KB |
|  | webpack | 96.25 KB | 29.32 KB | 26.37 KB |
|  | rolldown _(rust)_ | 95.10 KB | 29.14 KB | 26.20 KB |
|  | bun | 97.49 KB | 30.26 KB | 26.94 KB |
|  | deno _(rust)_ | 95.80 KB | 29.91 KB | 27.00 KB |
| **js-yaml** | vite | 52.13 KB | 15.51 KB | 14.00 KB |
|  | webpack | 51.75 KB | 15.53 KB | 13.96 KB |
|  | rolldown _(rust)_ | 51.23 KB | 15.59 KB | 14.10 KB |
|  | bun | 52.97 KB | 16.04 KB | 14.38 KB |
|  | deno _(rust)_ | 51.73 KB | 15.79 KB | 14.34 KB |

**Bundlers:** vite, webpack, rolldown (rust), bun, deno (rust).
**Method:** `yaml`/`js-yaml` resolve their ESM builds (browser platform); `lightning-yaml` is bundled from `src/index.ts`. Turbopack is omitted — it has no standalone library-bundling CLI (Next.js-only).
<!-- BENCH:BUNDLESIZE:END -->

## Layout

```
src/
  index.ts             # the parser — parse/parseAll (M0–M5) + stringify (M6)
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
