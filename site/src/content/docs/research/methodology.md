---
title: Benchmark & test methodology
description: How lightning-yaml is measured and kept honest — the speed/memory harness, candidate gating, and the consistency suite.
sidebar:
  order: 4
---

This page documents **how** lightning-yaml's benchmark and correctness numbers get
produced — the harness design, what's measured and why, and how the parser is
checked against the YAML 1.2 spec before any number is trusted. For the numbers
themselves, see [Benchmarks](/benchmarks/); for the parser's internal design
(tokenizer, allocation strategy), see [Research Overview](/research/overview/).

## Test data & approach

Test data spans three categories, all generated deterministically from a seeded
PRNG across a matrix of sizes and shapes:

- **JSON** — JSON is a subset of YAML 1.2, so the exact same bytes feed
  `JSON.parse` and both YAML parsers (~1 KB → ~10 MB). A clean apples-to-apples
  comparison.
- **YAML, plain** — the same JSON-shaped data emitted as *block* YAML, with no
  tags or anchors: "just JSON structures, in YAML syntax." `JSON.parse` can't
  read block YAML, so it's dropped from parsing these (but stays as a stringify
  baseline — the value is still JSON-compatible).
- **YAML, rich** — block YAML that uses YAML-only syntax: the `!!binary` tag
  (base64 blobs) and `&anchor`/`*alias` graph references (shared object
  references). JSON can neither read the text nor represent the value, so it's
  dropped from these entirely.

Which candidates run for which (category, op) is decided by `candidateApplies` in
[`bench/candidates.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/bench/candidates.ts).

**Speed** is measured with [mitata](https://github.com/evanwashere/mitata), run
sequentially. mitata JIT-compiles a batched measurement loop (4096 iterations
between timestamps) and has a `do_not_optimize` guard, so it stays accurate down
to sub-microsecond ops like `JSON.parse` — where Vitest/tinybench (one timestamp
per call, no anti-DCE guard) loses resolution. Benchmarks run **one at a time**:
parallel micro-timing is corrupted by CPU frequency scaling, cache/port
contention, and shared stop-the-world GC.

**Peak memory** is measured with isolated child processes, also run sequentially
— see below for why that needs a separate harness from mitata.

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
| --------- | --------------------------- | -------------------------- |
| JSON           | 284 MB                 | 17.4 MB                    |
| js-yaml        | 975 MB                 | 27 MB                      |
| **yaml**       | **2.68 GB**            | **39.8 MB**                |
| lightning-yaml | 369 MB                 | 27.8 MB                    |

mitata would report `yaml` at ~40 MB and **miss the 2.68 GB reality** — a 67×
blind spot of exactly the native/off-heap memory a YAML parser burns. So the two
tools are complementary: mitata for speed + per-call heap churn, our harness for
true peak RSS. (See [Peak memory](/benchmarks/#peak-memory) for the full
peak-RSS comparison across every workload.)

Each candidate runs in its **own OS process** (the correct isolation for a clean
peak), and workers run **one at a time**. We deliberately do *not* run them
concurrently: co-running the heavy parses (that 2.68 GB `yaml` job) can push the
machine into swapping, which corrupts RSS in ways that are hard to account for.
Sequential keeps every number trustworthy.

Iterations are fixed (`BENCH_ITERS`, default 25) and **should stay fixed**: peak
RSS is a sustained-allocation high-water mark that grows with iteration count
(e.g. `yaml` on the 1 MB fixture reports ~520 MB at 25 iterations but only
~308 MB at 5), so changing it shifts the peak-RSS numbers. `heap Δ` is
iteration-independent.

## Benchmark candidates

Grouped in
[`bench/candidates.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/bench/candidates.ts)
— a single registry reused by every benchmark:

| name           | group       | kind | parse                    | stringify             |
| -------------- | ----------- | ---- | ------------------------ | ---------------------- |
| JSON           | baseline    | json | `JSON.parse`             | `JSON.stringify`       |
| js-yaml        | competition | yaml | `load`                   | `dump`                 |
| yaml           | competition | yaml | `parse`                  | `stringify`            |
| lightning-yaml | ours        | yaml | `src/index.ts` _(M0–M5)_ | `src/index.ts` _(M6)_  |

`lightning-yaml` (group `ours`) is wired to
[`src/index.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/src/index.ts).
Its `parse` covers the full YAML 1.2 core feature set — flow/block syntax, block
scalars, anchors/aliases, tags including `!!binary`, directives, and
multi-document streams. `stringify` (milestone **M6**, tuned for throughput in
**M7**) is implemented too — a block-style dumper with scalar quoting,
`Uint8Array` → `!!binary`, and anchor/alias emission for shared references and
cycles — so it now runs in the stringify benches/tests rather than being
skipped. `Candidate.stringify` stays optional in the registry (for a
hypothetical future candidate that can't dump), and we still never substitute a
foreign serializer for one that lacks it — but today every candidate, including
ours, provides one. A per-fixture capability probe (`candidateHandles`)
benchmarks it only on inputs it can read today — now the JSON, block
`yaml-plain`, **and** anchor/`!!binary` `yaml-rich` rows for both `parse` and
`stringify`, since both ops handle all three categories. Each candidate's `kind`
(`json` vs. `yaml`) decides which data categories it runs on.

## Correctness — the consistency suite

Speed is meaningless if the output is wrong, so before the parser is trusted it
has to agree with a reference. We deliberately pick **one** oracle rather than
cross-checking every library against every other — they still legitimately
disagree on schema-typing edge cases, tag/anchor handling, and error strictness
(this is no longer a YAML-1.1-vs-1.2 split: js-yaml **v5**'s default schema is
now 1.2 core too, same as `yaml`):
[`bench/oracle.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/bench/oracle.ts)
designates **`yaml`** — the more spec-compliant of the two reference libraries,
per the yaml-test-suite conformance results on [Benchmarks](/benchmarks/#conformance)
— as our **differential reference**. The actual correctness authority is the
**YAML 1.2 spec** (operationalized by the yaml-test-suite); `yaml` is the one
library we diff against — sound where it agrees with the spec, with any
disagreement adjudicated against the spec rather than assumed to be our bug. The
oracle normalizes `!!binary` to a portable plain `Uint8Array` (the library
defaults to a Node `Buffer`, which wouldn't deep-equal a spec-portable
`Uint8Array`) and reads with `maxAliasCount: -1` for the anchor-heavy rich
fixtures.

`pnpm test` runs a [vitest](https://vitest.dev) suite over the same fixture data
the benchmarks use (up to 1 MB — the 10 MB `xlarge` case is skipped, too heavy
for an in-process oracle round-trip):

- [`test/consistency.test.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/test/consistency.test.ts)
  — for every fixture, `lightning-yaml.parse(text)` must deep-equal
  `oracle.parse(text)`, and — now that the dumper is implemented (M6; see also
  [`test/stringify.unit.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/test/stringify.unit.ts),
  `pnpm test:stringify`, **217/217 passing**) —
  `oracle.parse(lightning-yaml.stringify(value))` must deep-equal `value` too;
  we still don't substitute a foreign serializer for a candidate that lacks
  one. Rich fixtures additionally assert that `&anchor`/`*alias` reuse is
  reconstructed as **shared references**, not deep copies. Today the suite is
  **fully green** across all three categories — JSON, block `yaml-plain`, and
  `yaml-rich` alike, both parse and the now-active stringify round-trip; it
  stayed red on `yaml-rich` parse only until anchors + `!!binary` landed, and
  on the stringify round-trip only until the dumper (M6) landed.
- [`test/parser.unit.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/test/parser.unit.ts)
  — the parser's own fast node:test suite (`pnpm test:unit`, **364/364
  passing**): exact `JSON.parse` parity on the JSON fixtures, an
  escape/unicode/bignum torture set, prototype-pollution and depth-guard
  security, a seeded block round-trip corpus, and a regression case for every
  adversarial-review finding.
- [`test/fixtures.test.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/test/fixtures.test.ts)
  — sanity checks on the fixtures and oracle themselves: they parse
  deterministically, JSON-compatible data round-trips, rich fixtures really do
  contain `!!binary`/anchors and plain ones don't. These **pass**, so a red
  consistency test unambiguously means "ours is wrong," not "the harness is
  broken."

The suite is not a benchmark and doesn't measure anything; it's the correctness
gate that makes the benchmark numbers meaningful.

## Running the benchmarks & tests

For contributors and the curious — how to reproduce the numbers and run the
suites.

```bash
pnpm install
pnpm gen:fixtures       # generate bench/fixtures/data/* — JSON + YAML (gitignored, reproducible)

pnpm test               # vitest consistency suite (ours vs. the yaml oracle)
pnpm test:unit          # the parser's own node:test suite (fast, standalone)
pnpm test:suite         # yaml-test-suite conformance runner (364/373, 97.6%)

# low-level runners (all candidates by default; BENCH_SCOPE=competition|ours to filter)
pnpm bench:speed        # mitata parse + stringify throughput
pnpm bench:memory       # peak RSS + retained heap per candidate (sequential)

# report generators — emit results/benchmarks/*.yaml (gitignored)
pnpm bench:self         # our implementation + JSON baseline (fast) — local dev refresh
pnpm bench:competition  # full head-to-head, all parsers (slow) — what CI publishes
pnpm bench              # gen:fixtures + competition + self

pnpm typecheck
```

The two report scripts emit single-doc YAML to `results/benchmarks/{speed,memory}.yaml`
— gitignored, local artifacts — on two different cadences — see
[CLAUDE.md](https://github.com/jbsiddall/lightning-yaml/blob/main/CLAUDE.md):

- **`bench:self`** benchmarks only this repo's parser (+ JSON baseline) and is
  fast; run it before every commit for a cheap local read on our progress. Its
  output is never published.
- **`bench:competition`** benchmarks the full matrix — every parser including
  lightning-yaml — and is slow (xlarge/yaml). **CI** runs this same full matrix
  on every push to `main` and appends the result as a new document onto the
  orphan `benchmark-data` branch (only the full matrix is published; a partial
  `bench:self` run can't produce valid cross-library ratios).

The full result tables live on the [Benchmarks](/benchmarks/) page, which reads
that published history.

## Repository layout

```
src/
  index.ts             # the parser — parse/parseAll (M0–M5) + stringify (M6)
bench/
  candidates.ts        # candidates + groups + kind; applies/supports/handles gating
  oracle.ts            # the spec oracle (yaml) used by the fixtures + tests
  report.ts            # emit results/benchmarks/{speed,memory}.yaml: `report.ts self|competition`
  conformance/         # yaml-test-suite runner (`test:suite`) + compat cross-checks
  fixtures/
    datasets.ts        # dataset matrix (category × size × shape) + loaders
    generate.ts        # seeded, reproducible JSON + YAML generator
  speed/
    emit.ts            # mitata run → results/benchmarks/speed.yaml (isolated child process)
    parse.bench.ts     # mitata parse throughput (sequential)
    stringify.bench.ts # mitata stringify throughput (sequential)
  memory/
    worker.ts          # one isolated (candidate,dataset,op) measurement
    run.ts              # sequential orchestrator + text/markdown formatters
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
  exist. Rich fixtures are generated with the `yaml` library's 1.1 schema
  (that's what emits `!!binary`), and the `yaml` parser + oracle read them with
  `maxAliasCount: -1`, since the fixtures reuse anchors far past `yaml`'s
  default 100-alias DoS cap — fine for trusted, self-generated data.
- For **rich** stringify, output differs by design (js-yaml emits `!!binary`;
  `yaml`, by default, re-emits a Uint8Array as a number sequence) — we're
  measuring each serializer on equivalent in-memory data, not byte-identical
  text.
- Peak RSS includes Node's fixed baseline, so peak-RSS ratios are conservative;
  the `heap Δ` column isolates the retained result size. At ~1 KB inputs heap Δ
  is dominated by GC noise (it can go negative) — trust peak RSS there.

## See also

- [Benchmarks](/benchmarks/) — the current speed, memory, and conformance
  numbers this methodology produces.
- [Research Overview](/research/overview/) — why a pure-JS parser can approach
  `JSON.parse` speed in the first place.
- [Getting Started](/guides/getting-started/) — install and first parse.
