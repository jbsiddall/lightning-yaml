# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

`lightning-yaml` is a YAML parser that approaches `JSON.parse` / `JSON.stringify`
speed and memory. **The parser is feature-complete for YAML 1.2 core** —
[`src/index.ts`](src/index.ts) implements `parse`/`parseAll`/`stringify`: the JSON
subset, flow + block syntax, plain scalars with 1.2 core typing, quoting + escapes,
comments, flow/block maps & sequences, implicit **and** explicit (`? `/`: `) keys,
compact forms, block scalars (`|`/`>`), anchors/aliases (`&`/`*`), tags incl.
`!!binary`, `%YAML`/`%TAG` directives, and `---`/`...` multi-document streams. It
passes **≈97.6% of the official yaml-test-suite** (ahead of js-yaml v5 and the
`yaml` oracle). Only merge keys (`<<`, absent from the test corpus) are
unimplemented. The repo around it is:

- a **benchmark harness** that measures every parser (`JSON`, `js-yaml`, `yaml`,
  and now `lightning-yaml`) on speed (mitata) and peak memory (isolated child
  processes reading `process.resourceUsage().maxRSS`), across three data
  categories: JSON, plain block-YAML, and rich YAML (`!!binary` tags + `&`/`*`
  anchors); and
- a **vitest consistency suite** (`pnpm test`) plus the parser's own node:test
  suite (`pnpm test:unit`) that check our `parse` against a single spec oracle
  (the `yaml` library — see `bench/oracle.ts`). All three categories (JSON, block
  `yaml-plain`, and rich `yaml-rich` with `!!binary` + anchors) now pass; the dumper
  is covered by `pnpm test:stringify` (round-trip vs the oracle).

[README.md](README.md) is the **adopter-facing** doc — the pitch, install, usage,
and drop-in story for developers picking up the library, plus the design/rationale
of the harness lower down. The **full auto-generated benchmark tables live in
[BENCHMARKS.md](BENCHMARKS.md)** (and on the docs site, <https://lightning-yaml.dev>),
not in the README, which carries only a compact snapshot.

## Integrity of benchmarks and claims — non-negotiable

Every number and claim this repo publishes must be true and fair. When you run
benchmarks or write copy (README, docs, comments, commit messages), report the
honest result — never tune, cherry-pick, or phrase anything to flatter
lightning-yaml, and never bend the methodology in its favour. Hold every parser we
compare against to the same rules. If honest measurement makes our speed or
conformance claims worse, change the claims: accuracy outranks looking good.

## Comments — explain *why*, not *what*

Only comment when the code can't speak for itself. If a reader can work out what a
line does from the code alone, don't comment it — this applies to CI/workflow YAML as
much as to `src`. Reserve comments for non-obvious rationale: a constraint, a gotcha,
or why a choice was made (especially where getting it wrong is costly). Prefer
deleting a redundant or stale comment over keeping it. Don't add unnecessary comments.

## Source-of-truth precedence — when sources disagree

Highest wins; the lower source is the bug to fix (don't average, and "more detailed"
doesn't win). Scope it to the claim — the **YAML 1.2.2 spec owns parse/dump
correctness**, benchmarks own *numbers*, code owns *behavior*, README/research own
*why*:

**YAML 1.2.2 spec (via the yaml-test-suite = the spec operationalized) › CLAUDE.md
(process/policy) › measured output (`BENCHMARKS.md` + suite pass rate) › `src/` (real
behavior & API) › README / `docs/research/` (intent) › `site/`
(downstream; its API reference is generated from `src/`, never ahead of it).**

The reference implementations we test against — `yaml` (`bench/oracle.ts`) and
js-yaml — are **differential aids, NOT the definition of correct.** A disagreement
between our output and an implementation flags a *candidate* to investigate; the
**spec adjudicates**. Where an implementation diverges from the spec, the spec wins,
and lightning-yaml deliberately matches the spec against it — e.g. we reject an
implicit flow collection key (`{[1,2]: v}`), a spec error (yaml-test-suite SBG9/X38W)
that `yaml` wrongly accepts. So "matches the oracle" is never on its own a proof of
correctness, and "differs from the oracle" is never on its own a bug: check the spec.
Trust an implementation only where it agrees with the spec. The one sanctioned
deviation *from* the spec is explicit and documented — duplicate-key last-wins, for
`JSON.parse` parity (see `docs/research/2026-07-12-adversarial-torture-tests.md`).

Code can still carry bugs — behavior that contradicts the spec (or a stated design
goal) is a bug to fix, not intent to enshrine.

## Orchestration loop — how to work in this repo

This repo is driven by an **orchestrator + subagents** pattern. The top-level agent
is a project manager: it decides *what* to do next and delegates *doing* it, keeping
its own context lean. Follow this loop for any non-trivial request.

### When to loop vs. act directly

- **Act directly** (no loop, no subagent) for trivial requests — a README/doc/comment
  tweak, a one-line change, answering something you already know: anything likely
  **≤5 tool calls** (file *reads* don't count) with no code-correctness risk.
- **Run the loop** for anything non-trivial: any task likely to need **>5 non-read
  tool calls**, touch parser/harness correctness, or require multi-file reasoning.

### The loop (repeat until the user's goal is met)

1. **ASSESS.** State the user's goal and current status. Complete? Verify and finish.
   Otherwise pick the **next concrete chunk** that moves closest to the goal. Record
   the reasoning in a scratch notes file.
2. **PLAN** (if the chunk is non-trivial) — spawn an **opus** subagent to produce a
   concrete plan: root cause, exact files/lines, minimal diff, verification, risks.
   Skip only when the implementation is obvious.
3. **IMPLEMENT** — spawn a subagent to do the work. **Default to Sonnet to save token
   budget**; use **opus only** when the implementation is genuinely complex / needs
   deep reasoning. It implements, adds/updates tests, runs the gate, writes its result
   to a scratch file.
4. **CRITIQUE (adversarial)** — spawn an **opus** subagent to *try to break* the change:
   hunt oracle/spec divergences, edge-case regressions, and confirm the gate really
   passes and the chunk is *actually* done. Fix confirmed findings (loop back to 3 if
   needed). Never accept "looks fine."
5. **COMMIT** — only once the gate is green and the critic confirms done. Commit the
   chunk (push per milestone).
6. **REPEAT** from 1.

### PRs squash-merge — keep the title & description accurate

PRs land on `main` as a **single squash commit** whose message is the PR **title +
description** (internal commits are collapsed) — so those must describe the *whole*
change, not any one commit. When a PR is opened (by you or the user), write the
title/description to match the work; if later turns add commits to the branch, go back
and update them so they stay accurate.

### Token discipline — temp files + tiny prompts (mandatory)

Chat history does **not** retain files, and a big inline prompt/result is re-paid in
tokens every turn it lingers in context — whereas a file on disk is durable, shared
context at zero recurring cost. So:

- **Coordinate through scratch files.** The orchestrator writes detailed task
  instructions to a temp file (under the session scratchpad); each subagent writes its
  plan/result/critique to a temp file. Ephemeral per-task detail lives in scratch,
  never in committed docs.
- **Every subagent prompt is tiny** — essentially *"Your instructions are in `<path>`.
  Read it immediately and follow it exactly."* Put ALL the detail in the file.
- **Every subagent result is tiny** — the agent writes its full output to a result file
  and returns ≤4 sentences + that path. The orchestrator reads only what it needs.
- **The orchestrator keeps its context lean** — never read large files directly
  (delegate); retain only short summaries.

### Concurrency

Run independent chunks in parallel (multiple subagents in one message). But only **one**
file-writing/committing subagent at a time per shared working tree — concurrent writers
corrupt each other's typecheck/test runs and race the git index. Read-only agents may
overlap freely. (For true parallel writers, isolate with a git worktree.)

### The correctness gate (this repo)

A chunk is **not done** until, as applicable: `pnpm typecheck` clean · `pnpm test`
(vitest, all green) · `pnpm test:unit` · `pnpm test:stringify` · `pnpm test:suite`
(yaml-test-suite pass rate must **not** drop) · `pnpm bench:self` shows **no** perf
regression. Never claim progress or commit on a red gate; refresh the BENCHMARKS.md
bench blocks per the Benchmarking rules below.

## Research dossier — when to read it

[docs/research/](docs/research/) holds the parser-strategy research
(2026-07). Do **not** re-derive or contradict it from scratch — read the
relevant file first. Skip it entirely for harness tweaks, fixtures, docs,
or dependency chores. Read it when the task touches parser design,
implementation, or performance — pick by task:

- Implementing/designing parser code → `2026-07-12-design-a-pure-js-parser.md` (the recommended pure-JS design)
- Debugging slow code / optimizing a hot path → `2026-07-12-pure-js-speed-ceiling.md` + `2026-07-12-local-microbenchmarks.md` (V8 tricks: `2026-07-12-v8-json-parse-anatomy.md`)
- Writing or reviewing perf-sensitive JS (JIT tiers, monomorphism, deopt checks) → `2026-07-12-v8-optimization-guide.md`
- Comparing against js-yaml / yaml behavior or speed → `2026-07-12-js-yaml-internals.md` / `2026-07-12-eemeli-yaml-internals.md`
- Anything WASM or native → `2026-07-12-wasm-route-evaluation.md` + `2026-07-12-design-b-wasm-parser.md` (route was rejected — read before reopening)
- Before relying on a perf claim from the dossier → `2026-07-12-adversarial-verdicts.md` (three claims were refuted)
- Planning benchmarks, fixtures, stringify, or conformance work → `2026-07-12-completeness-critique.md`
- Adversarial / security / torture testing, or parser-differential work → `2026-07-12-adversarial-torture-tests.md` (its findings are locked by `test/adversarial.unit.ts`)
- Chasing `JSON.parse` / `JSON.stringify` performance → the `2026-07-14-*` performance notes (e.g. `2026-07-14-stringify-speedup-via-key-caching.md`, `2026-07-14-parse-multiline-speedup-lever.md`, `2026-07-14-memory-value-interning.md`)

When **creating or editing** a file under `docs/research/`, follow
[`docs/research/CONVENTIONS.md`](docs/research/CONVENTIONS.md) — the flat-folder layout,
`YYYY-MM-DD-<goal>.md` naming, tone, and required structure for research notes.

## Key commands

```bash
pnpm install
pnpm gen:fixtures       # (re)generate JSON + YAML fixtures (gitignored, reproducible)
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest consistency suite (ours vs. the yaml oracle)
pnpm bench:self         # benchmark OUR implementation only (fast)
pnpm bench:competition  # benchmark the competition, full matrix (slow)
```

Fixtures and `results/` are gitignored; the BENCHMARKS.md benchmark tables are
committed.

## Benchmarking rules — read before committing

Benchmark results live in [BENCHMARKS.md](BENCHMARKS.md) in three
auto-generated blocks (head-to-head, our implementation, bundle size) with
different refresh cadences. Keep them current so we can always see how our
parser stands against the competition. (The README carries only a small
hand-written snapshot — refresh it too if the representative numbers move
materially.)

### 1. Before every commit or PR: refresh OUR results

Run:

```bash
pnpm bench:self
```

and commit the updated `BENCHMARKS.md` "Our implementation" block along with your
change.

`bench:self` benchmarks only this repo's own parser (group `ours` in
`bench/candidates.ts`) plus the JSON baseline — fast, so run it every commit. The
per-fixture capability probe (`candidateHandles`) still drops any candidate from a
fixture it can't parse (so no bogus "error" rows appear), but lightning-yaml now
reads every committed category — JSON, block `yaml-plain`, and rich `yaml-rich`
(`!!binary` + `&`/`*` anchors) — so nothing is skipped for it today. Do **not** run
the (slow) full-matrix benchmark on ordinary commits.

Also run `pnpm test` (vitest consistency vs the oracle) and `pnpm test:unit`
(the parser's own node:test suite) before committing parser changes — together
they are the correctness gate. All consistency categories — JSON, block
`yaml-plain`, and rich `yaml-rich` (`!!binary` + anchors) — currently pass; keep
them green.

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

### 3. Refresh bundle size on dependency or notable `src`-size changes

Run:

```bash
pnpm bench:bundlesize
```

This bundles each library's `parse` + `stringify` with five bundlers (Vite, Webpack,
Bun, Deno, Rolldown) — tree-shaking + minification, browser platform — and rewrites the
"Bundle size" block. Sizes are **deterministic** (unlike timings), so commit the
refreshed block when:

- **dependency versions change** — `yaml`, `js-yaml`, or a bundler is bumped; or
- **`src/index.ts` grows/shrinks materially** — our own bundle size moved.

The bundler toolchain is isolated in `bench/bundlesize/package.json` (installed on first
run), so it never touches the root install or `pnpm typecheck`; the harness is plain
`.mjs` and excluded from the gate. Bun/Deno rows appear only when those runtimes are on
PATH. Not needed on ordinary commits. See [bench/bundlesize](bench/bundlesize/README.md).

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
- **The reference aid** (`bench/oracle.ts`) is `yaml` — a *differential aid*, NOT
  ground truth for correctness (the spec is; see the precedence rule above).
  Fixtures' in-memory values (for stringify) and the consistency tests both go
  through it; that's sound because the fixtures avoid spec-contested constructs. It
  parses with `maxAliasCount: -1` (our rich fixtures reuse anchors thousands of
  times); the `yaml` candidate does too. Don't cross-check competitors against each
  other — compare ours against this reference, and adjudicate any disagreement
  against the spec (the yaml-test-suite conformance run), never assume it's our bug.
- Both harnesses run **sequentially**. Speed can't be parallelized without
  corrupting timing; the memory harness isn't parallelized either, to avoid
  co-running heavy parses swapping the machine and corrupting RSS. The vitest
  suite runs files sequentially too (`fileParallelism: false`) for the same reason.
- Memory iterations are fixed (`BENCH_ITERS`, default 25) and should stay fixed:
  peak RSS grows with iteration count, so changing it shifts the numbers and
  breaks comparability (`heap Δ` is iteration-independent).
- After changing harness code, run `pnpm typecheck` **and** `pnpm test`.
