# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

`lightning-yaml` aims to be a YAML parser that approaches `JSON.parse` /
`JSON.stringify` speed and memory. **There is no parser implementation yet** —
right now the repo is a benchmark harness that measures the competition
(`JSON`, `js-yaml`, `yaml`) on speed (mitata) and peak memory (isolated
child processes reading `process.resourceUsage().maxRSS`). See
[README.md](README.md) for the design and rationale.

## Key commands

```bash
pnpm install
pnpm gen:fixtures       # (re)generate the JSON fixtures (gitignored, reproducible)
pnpm typecheck          # tsc --noEmit
pnpm bench:self         # benchmark OUR implementation only (fast)
pnpm bench:competition  # benchmark the competition, full matrix (slow)
```

Fixtures and `results/` are gitignored; the README benchmark tables are
committed.

## Benchmarking rules — read before committing

Benchmark results live in [README.md](README.md) in two blocks with two
different refresh cadences. Keep them current so we can always see how our
parser stands against the competition.

### 1. Before every commit or PR: refresh OUR results

Run:

```bash
pnpm bench:self
```

and commit the updated `README.md` "Our implementation" block along with your
change.

**Caveat — there may be no implementation yet.** `bench:self` benchmarks only
this repo's own parser (group `ours` in `bench/candidates.ts`). Until a parser
exists, there is nothing to benchmark: the command just (re)writes a short
"no implementation yet" note and exits. That's expected — nothing to update in
that case. Do **not** run the (slow) competition benchmark on ordinary commits.

Note: timings drift run-to-run — that's normal. Update to the latest
representative run; peak-RSS / heap-Δ are the stable figures. Run on an
otherwise-quiet machine.

### 2. Re-run the COMPETITION benchmark only when deps or data change

Run:

```bash
pnpm bench:competition
```

and commit the updated "Competition" block **only** when:

- **dependency versions change** — `js-yaml`, `yaml`, or `mitata` are bumped; or
- **the datasets change** — fixtures added/grown or `bench/fixtures/datasets.ts`
  edited.

This is the slow one (the xlarge/yaml cases take several minutes). It is **not**
needed on ordinary commits — the competition numbers only move when the code
being measured or the inputs change.

## Notes for changes to the harness

- `bench/candidates.ts` is the single source of truth. To add our parser, append
  a candidate with `group: "ours"` — it then appears in every benchmark and in
  `bench:self` automatically.
- Both harnesses run **sequentially**. Speed can't be parallelized without
  corrupting timing; the memory harness isn't parallelized either, to avoid
  co-running heavy parses swapping the machine and corrupting RSS.
- Memory iterations are fixed (`BENCH_ITERS`, default 25) and should stay fixed:
  peak RSS grows with iteration count, so changing it shifts the numbers and
  breaks comparability (`heap Δ` is iteration-independent).
- After changing harness code, run `pnpm typecheck`.
