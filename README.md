# lightning-yaml

A fast YAML parser — currently just the **benchmark harness** that establishes
the baseline we aim to beat: how `JSON.parse`/`JSON.stringify` compare against
the two leading JS YAML libraries (`yaml` and `js-yaml`) on **speed** and
**peak memory**.

No parser is implemented yet. This is the measuring stick.

## Approach

- **Test data is JSON.** JSON is a subset of YAML 1.2, so the exact same bytes
  feed `JSON.parse` and both YAML parsers — a clean apples-to-apples comparison.
  Fixtures are generated deterministically (seeded PRNG) across a matrix of
  sizes (~1 KB → ~10 MB) and shapes (records, nested).
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

| name    | group       | parse          | stringify        |
| ------- | ----------- | -------------- | ---------------- |
| JSON    | baseline    | `JSON.parse`   | `JSON.stringify` |
| js-yaml | competition | `load`         | `dump`           |
| yaml    | competition | `parse`        | `stringify`      |
| _lightning-yaml_ | _ours_ | _(none yet)_ | _(none yet)_ |

When our parser exists it joins as group `ours` and appears in every benchmark
automatically.

## Usage

```bash
pnpm install
pnpm gen:fixtures       # generate bench/fixtures/data/*.json (gitignored, reproducible)

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
_Not generated yet — run `pnpm bench:competition`._
<!-- BENCH:COMPETITION:END -->

### Our implementation

<!-- BENCH:OURS:START -->
_No `lightning-yaml` implementation exists yet, so there is nothing to benchmark here._

_This block refreshes automatically once a parser is registered in `bench/candidates.ts` with group `ours`; until then it stays as this note._
<!-- BENCH:OURS:END -->

## Layout

```
bench/
  candidates.ts        # candidates + groups (baseline/competition/ours), scope selection
  report.ts            # regenerate README blocks: `report.ts self|competition`
  fixtures/
    datasets.ts        # dataset matrix (size × shape) + path helpers
    generate.ts        # seeded, reproducible JSON generator
  speed/
    parse.bench.ts     # mitata parse throughput (sequential)
    stringify.bench.ts # mitata stringify throughput (sequential)
  memory/
    worker.ts          # one isolated (candidate,dataset,op) measurement
    run.ts             # sequential orchestrator + text/markdown formatters
  util/                # seeded PRNG + formatting helpers
```

## Caveats

- Input is **flow-style** JSON, which is a valid but not block-style YAML
  document — it exercises the parsers on the exact bytes chosen for the
  comparison. A block-YAML variant (via `yaml.stringify`) could be added later
  for an apples-to-YAML view.
- Peak RSS includes Node's fixed baseline, so peak-RSS ratios are conservative;
  the `heap Δ` column isolates the retained result size. At ~1 KB inputs heap Δ
  is dominated by GC noise (it can go negative) — trust peak RSS there.

## Development

I use [Claude](https://www.anthropic.com/claude) as a coding assistant on this
project. Every change is fully code-reviewed and owned by me before it lands.
