# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

`lightning-yaml` aims to be a YAML parser that approaches `JSON.parse` /
`JSON.stringify` speed and memory. **There is no parser implementation yet** —
right now the repo is a benchmark harness that measures the competition
(`JSON`, `js-yaml`, `yaml`) on speed (mitata) and peak memory (isolated
child processes reading `process.resourceUsage().maxRSS`). See
[README.md](README.md) for the design and rationale.

## Research dossier — when to read it

[docs/research/](docs/research/) holds the parser-strategy research
(2026-07). Do **not** re-derive or contradict it from scratch — read the
relevant file first. Skip it entirely for harness tweaks, fixtures, docs,
or dependency chores. Read it when the task touches parser design,
implementation, or performance — pick by task:

- Implementing/designing parser code → `README.md` (verdict) then `07-design-a-pure-js.md`
- Debugging slow code / optimizing a hot path → `05-pure-js-ceiling.md` + `06-local-microbenchmarks.md` (V8 tricks: `03-v8-json-parse.md`)
- Writing or reviewing perf-sensitive JS (JIT tiers, monomorphism, deopt checks) → `12-v8-optimization-guide.md`
- Comparing against js-yaml / yaml behavior or speed → `01-js-yaml-internals.md` / `02-eemeli-yaml-internals.md`
- Anything WASM or native → `04-wasm-route.md` + `08-design-b-wasm.md` (route was rejected — read before reopening)
- Before relying on a perf claim from the dossier → `10-adversarial-verdicts.md` (three claims were refuted)
- Planning benchmarks, fixtures, stringify, or conformance work → `11-completeness-critique.md`

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
