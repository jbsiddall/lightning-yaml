# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

`lightning-yaml` aims to be a YAML parser that approaches `JSON.parse` /
`JSON.stringify` speed and memory. **The parser is real and partial** —
[`src/index.ts`](src/index.ts) implements `parse`/`parseAll` for the JSON subset
and YAML flow + block syntax (milestones M0–M3): plain scalars with 1.2
core-schema typing, quoting + escapes, comments, flow/block maps and sequences,
implicit keys, and compact forms. Not yet implemented (they throw
`NotImplementedError` or a clear parse error): `stringify`, block scalars
(`|`/`>`), anchors/aliases + tags (`!!binary`), merge keys, and multi-document
streams (`---`/`...`). The repo around it is:

- a **benchmark harness** that measures every parser (`JSON`, `js-yaml`, `yaml`,
  and now `lightning-yaml`) on speed (mitata) and peak memory (isolated child
  processes reading `process.resourceUsage().maxRSS`), across three data
  categories: JSON, plain block-YAML, and rich YAML (`!!binary` tags + `&`/`*`
  anchors); and
- a **vitest consistency suite** (`pnpm test`) plus the parser's own node:test
  suite (`pnpm test:unit`) that check our `parse` against a single spec oracle
  (the `yaml` library — see `bench/oracle.ts`). The JSON and block `yaml-plain`
  cases pass; the `yaml-rich` cases stay red until anchors + `!!binary` land.

See [README.md](README.md) for the design and rationale.

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
pnpm gen:fixtures       # (re)generate JSON + YAML fixtures (gitignored, reproducible)
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest consistency suite (ours vs. the yaml oracle)
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

`bench:self` benchmarks only this repo's own parser (group `ours` in
`bench/candidates.ts`) plus the JSON baseline — fast, so run it every commit. The
per-fixture capability probe (`candidateHandles`) benchmarks lightning-yaml only
on the fixtures it can read today (JSON + block `yaml-plain`) and skips those
whose constructs aren't implemented yet (e.g. `yaml-rich` anchors/`!!binary`), so
no "error" rows appear. Do **not** run the (slow) full-matrix benchmark on
ordinary commits.

Also run `pnpm test` (vitest consistency vs the oracle) and `pnpm test:unit`
(the parser's own node:test suite) before committing parser changes — together
they are the correctness gate. The `yaml-rich` consistency cases stay red until
anchors + `!!binary` land (a later milestone); everything else is green.

Note: timings drift run-to-run — that's normal. Update to the latest
representative run; peak-RSS / heap-Δ are the stable figures. Run on an
otherwise-quiet machine.

### 2. Re-run the head-to-head benchmark on deps, data, or a milestone

Run:

```bash
pnpm bench:competition
```

This now benchmarks the **full matrix — every parser including lightning-yaml**
(scope `all`) and refreshes the "All parsers — head-to-head" block. Re-run and
commit it when:

- **dependency versions change** — `js-yaml`, `yaml`, or `mitata` are bumped;
- **the datasets change** — fixtures added/grown or `bench/fixtures/datasets.ts`
  edited; or
- **our parser reaches a milestone** worth a fresh head-to-head snapshot (fast
  per-commit tracking of our parser alone stays in the "Our implementation"
  block via `bench:self`).

This is the slow one (the xlarge/`yaml` cases take several minutes) — not needed
on ordinary commits.

## Notes for changes to the harness

- `bench/candidates.ts` is the single source of truth. `lightning-yaml` is
  already registered there (group `ours`), wired to `src/index.ts` — to bring it
  to life you implement `src/index.ts`, you don't touch the registry. Each
  candidate declares a `kind` (`json` vs. `yaml`); `candidateApplies` uses it
  with the dataset category to decide which candidates run for parse vs.
  stringify (e.g. JSON never parses block YAML), and `candidateSupports` skips
  candidates whose op still throws `NotImplementedError`.
- **Fixture categories** live in `bench/fixtures/datasets.ts`: `json`,
  `yaml-plain` (JSON-shaped data in block YAML, no tags/anchors), and
  `yaml-rich` (`!!binary` + `&`/`*`). The generator emits rich fixtures with the
  `yaml` library's 1.1 schema. Keep YAML fixtures ≤1 MB to bound the competition
  run; the 10 MB case stays JSON-only. Fixtures are gitignored, and `pnpm test`
  auto-generates only the **missing** ones — after editing the generator or
  dataset defs, run `pnpm gen:fixtures` to regenerate all, or tests run on stale
  data.
- **The oracle** (`bench/oracle.ts`) is the one library we treat as ground truth
  for correctness (`yaml`). Fixtures' in-memory values (for stringify) and the
  consistency tests both go through it. It parses with `maxAliasCount: -1` (our
  rich fixtures reuse anchors thousands of times); the `yaml` candidate does too.
  Don't cross-check competitors against each other — only ours against the oracle.
- Both harnesses run **sequentially**. Speed can't be parallelized without
  corrupting timing; the memory harness isn't parallelized either, to avoid
  co-running heavy parses swapping the machine and corrupting RSS. The vitest
  suite runs files sequentially too (`fileParallelism: false`) for the same reason.
- Memory iterations are fixed (`BENCH_ITERS`, default 25) and should stay fixed:
  peak RSS grows with iteration count, so changing it shifts the numbers and
  breaks comparability (`heap Δ` is iteration-independent).
- After changing harness code, run `pnpm typecheck` **and** `pnpm test`.
