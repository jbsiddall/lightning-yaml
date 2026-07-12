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
- **Speed → [mitata](https://github.com/evanwashere/mitata).** GC/heap-aware
  timing; run under `--expose-gc` for GC columns. (Vitest's `bench()` also does
  speed, but it can't measure memory, so we don't take that dependency.)
- **Peak memory → isolated child processes.** No in-process tool measures true
  peak reliably (GC timing is non-deterministic), so each candidate runs in its
  own `node --expose-gc` process and we read `process.resourceUsage().maxRSS`.

## Candidates

| name    | parse             | stringify           |
| ------- | ----------------- | ------------------- |
| JSON    | `JSON.parse`      | `JSON.stringify`    |
| js-yaml | `load`            | `dump`              |
| yaml    | `parse`           | `stringify`         |

Defined in [`bench/candidates.ts`](bench/candidates.ts) — a single registry
reused by every benchmark. A future `lightning-yaml` implementation added here
shows up in all benchmarks automatically.

## Usage

```bash
pnpm install
pnpm gen:fixtures   # generate bench/fixtures/data/*.json (gitignored, reproducible)
pnpm bench:speed    # mitata parse + stringify throughput
pnpm bench:memory   # peak RSS + retained heap per candidate
pnpm bench          # all of the above
pnpm typecheck
```

## Layout

```
bench/
  candidates.ts        # the three candidates behind a common interface
  fixtures/
    datasets.ts        # dataset matrix (size × shape) + path helpers
    generate.ts        # seeded, reproducible JSON generator
  speed/
    parse.bench.ts     # mitata parse throughput
    stringify.bench.ts # mitata stringify throughput
  memory/
    worker.ts          # one isolated (candidate,dataset,op) measurement
    run.ts             # orchestrator: spawns workers, prints the table
  util/                # seeded PRNG + formatting helpers
```

## Caveats

- Input is **flow-style** JSON, which is a valid but not block-style YAML
  document — it exercises the parsers on the exact bytes chosen for the
  comparison. A block-YAML variant (via `yaml.stringify`) could be added later
  for an apples-to-YAML view.
- Peak RSS includes Node's fixed baseline, so peak-RSS ratios are conservative;
  the `heap Δ` column isolates the retained result size.
