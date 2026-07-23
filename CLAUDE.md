# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

`lightning-yaml` is a **YAML 1.2.2-compliant parser and serializer**
([`src/core.ts`](src/core.ts) implements `parse`/`parseAll`/`stringify`). The
project's **goals are the north star, and their authoritative statement lives in
[README.md](README.md#project-priorities)** — spec compliance first, then
performance approaching the browser's native `JSON.parse`/`JSON.stringify` —
read them from there rather than redefine them here (YAML 1.1 is a non-goal). It
targets high conformance to the official yaml-test-suite; the live pass rate
comes from `pnpm test:suite`, not pinned here. Around the parser the repo carries two things, each detailed in
its own section below: a **benchmark harness** (speed + peak memory, every
parser, across JSON / plain-block-YAML / rich-YAML data) and a **consistency +
conformance suite** that checks `parse`/`stringify` against the `yaml` oracle
(`bench/oracle.ts`).

[README.md](README.md) is the **adopter-facing** doc (pitch, install, usage,
drop-in story); the full benchmark tables live on the docs site
<https://lightning-yaml.dev> (published from the orphan `benchmark-data`
branch), not in this file or the README.

## Integrity of benchmarks and claims — non-negotiable

Every number and claim this repo publishes must be true and fair. When you run
benchmarks or write copy (README, docs, comments, commit messages), report the
honest result — never tune, cherry-pick, or phrase anything to flatter
lightning-yaml, and never bend the methodology in its favour. Hold every parser we
compare against to the same rules. If honest measurement makes our speed or
conformance claims worse, change the claims: accuracy outranks looking good.

**Provenance markers.** Tag every hardcoded number or competitor claim in a
`.md`/`.mdx` with an invisible HTML comment of what it depends on —
`<!-- bench:<data sha> js-yaml:<ver> ly:<repo sha> -->` (only the pins that apply)
— so `grep -rnE 'bench:|js-yaml:|yaml:|ly:'` catches drift; prefer deriving from
the data over hardcoding. Full scheme + rollout: issue #30.

## Comments — explain *why*, not *what*

Only comment when the code can't speak for itself. If a reader can work out what a
line does from the code alone, don't comment it — this applies to CI/workflow YAML as
much as to `src`. Reserve comments for non-obvious rationale: a constraint, a gotcha,
or why a choice was made (especially where getting it wrong is costly). Prefer
deleting a redundant or stale comment over keeping it. Don't add unnecessary comments.

## Audience & voice — write for the reader, not the parser

Every written artifact has a reader; name them and pitch to them. **User-facing
prose — a PR title and its top-line summary, changeset entries, `README`, release
notes / `CHANGELOG.md`, the docs site — is read by devs who use YAML every day but
don't know the 1.2.2 grammar or this parser's internals.** Write it in plain
language: describe the *observable* change (what input used to break, what now
works) and let a tiny before/after YAML snippet carry the point. What to keep
*out* is the vocabulary few readers can decode without deep context:
grammar-production names (`c-l-block-map-explicit-key`), internal symbols
(`parseFlowKeyAnchored`), and bare suite IDs standing in for an explanation
(`SBG9`/`X38W`). Litmus test: if a working YAML dev couldn't tell *what changed for
them* from your summary, rewrite the summary.

**Spec section references are welcome, not stripped** — tying a claim back to the
YAML 1.2.2 spec is a feature, not clutter; just format the reference for its medium.
In rendered-markdown copy (PR titles/descriptions, issue descriptions, `README`, the
docs site, research notes) link the reference to its heading on the official spec
(<https://yaml.org/spec/1.2.2/>) rather than leaving a bare `§8.2.2`. In plain-text
content (code comments) keep the existing `§8.2.2` syntax.

The grammar-level depth isn't banned, it's *placed* — production names and internal
mechanics belong where the reader is a maintainer: the PR's **Correctness note** (the
template asks for the spec/suite citation there), a code comment, or a research note.
Even there, favour a concrete YAML example over a paragraph of jargon, and reach for
precise parser/spec terminology only when it's genuinely the clearest way to say the
thing — necessary precision is fine, a jargon wall where an example would do is not.

## Source-of-truth precedence — when sources disagree

Highest wins; the lower source is the bug to fix (don't average, and "more detailed"
doesn't win). Scope it to the claim — the **YAML 1.2.2 spec owns parse/dump
correctness**, benchmarks own *numbers*, code owns *behavior*, README/research own
*why*:

**YAML 1.2.2 spec (via the yaml-test-suite = the spec operationalized) › CLAUDE.md
(process/policy) › measured output (the `benchmark-data` orphan branch + suite pass
rate) › `src/` (real behavior & API) › README / the research notes (intent) › `site/`'s generated API reference
(downstream; generated from `src/`, never ahead of it).**

The reference implementations we test against — `yaml` (`bench/oracle.ts`) and
js-yaml — are **differential aids, NOT the definition of correct.** A disagreement
between our output and an implementation flags a *candidate* to investigate; the
**spec adjudicates**. Where an implementation diverges from the spec, the spec wins,
and lightning-yaml deliberately matches the spec against it — e.g. we reject an
implicit flow collection key (`{[1,2]: v}`), a spec error (yaml-test-suite SBG9/X38W)
that `yaml` wrongly accepts. So "matches the oracle" is never on its own a proof of
correctness, and "differs from the oracle" is never on its own a bug: check the spec.
Trust an implementation only where it agrees with the spec. **Sanctioned deviations
from the spec or the goals live in exactly one place — the [Decisions and
deviations](README.md#decisions-and-deviations) section of `README.md` — and nowhere
else counts: a deviation asserted in this file, a research note, or a code comment but
*absent* from that README section is not approved, so flag/escalate it rather than wave
it through.** Keeping the registry in the one doc everyone reads is deliberate — it
keeps every standing exception (e.g. duplicate-key last-wins, for `JSON.parse` parity;
the rationale is in `site/src/content/docs/research/notes/2026-07-12-adversarial-torture-tests.md`)
visible instead of buried.

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
3. **IMPLEMENT + gate + commit — each chunk is its own commit.** Spawn a subagent
   (**default Sonnet**; **opus only** when genuinely complex) to implement, add/update
   tests, and run the gate. As soon as the gate is green, **commit the chunk as its own
   commit** — don't wait for the review. PRs squash-merge, so intermediate commits
   collapse; committing now hands the reviewers an **immutable git hash** to review.
4. **REVIEW the chunk in parallel — don't block on it.** Instead of a bespoke critic, spawn
   the `/code-review` reviewers whose Domain the chunk touches (`.claude/commands/code-review-*`),
   **scoped to the just-committed hash** (they diff `<hash>^..<hash>`) — mostly Sonnet, fast —
   *in the background*, then go **straight back to step 1 for the next chunk** while they run.
   Each reviewer reads the change off the **commit hash** (a static, immutable view), never the
   live tree, so the review of chunk N and the implementation of chunk N+1 overlap without
   racing. When findings come back, fold confirmed ones in as a **follow-up commit**. Overlapping
   the review with the next chunk is the main latency win — never serialize it in front. Pick
   chunk boundaries so the next chunk rarely has to unwind; if a finding forces a real change,
   fix it forward as a new commit.
5. **REPEAT** from 1 until every chunk is committed and every background review has
   landed (findings folded in). Push per milestone.
6. **Comprehensive review at hand-off.** When the whole change is ready for the user, run
   **`/code-review`** — the multi-reviewer panel that runs its reviewers in parallel,
   read-only, over the committed diff (see `.claude/commands/code-review.md`). Loop it
   until every reviewer approves the current commit, then hand back.

**One review mechanism, two scopes.** It's the same `/code-review` panel throughout — no
separate adversarial pass to maintain. During the loop it runs **scoped to each commit**
(step 4, pipelined so it never blocks the next chunk; only the reviewers whose Domain the
commit touched run, so it stays fast); at hand-off it runs **over the whole PR** (step 6).
Same reviewers, same files, same read-only-off-a-git-hash rule — just a per-commit scope
versus the full `BASE..HEAD` scope.

### PRs squash-merge — keep the title & description accurate

PRs land on `main` as a **single squash commit** whose message is the PR **title +
description** (internal commits are collapsed) — so together they must describe the
*whole* change, not any one commit. Split that job by role: the **description**
covers the full scope (every piece of work, however small); the **title is a
headline, not a table of contents**. Name the one piece of work a reader most needs
in order to understand the change, and phrase the title around *that* — prioritize a
title a working YAML dev can read in one pass over one that enumerates every facet of
the PR. A smaller, closely-related piece of work (a picker UI tweak that a bigger
data change implies, a follow-on field added alongside the main one) doesn't need its
own clause in the title — the reader should be able to infer it, or at worst not be
surprised by it, once they open the description or the diff.

For example, prefer `benchmarks: run on node & in browser` over `benchmarks: runtime
dimension — canonical environment, /benchmarks picker, runtime provenance in memory
data`: the picker and provenance fields are expected consequences of adding a second
runtime, not independent claims the title needs to carry — the description is where
they get spelled out.

When a PR is opened (by you or the user), write the title/description to match the
work; if later turns add commits to the branch, go back and update them so they stay
accurate. Don't mention Claude in the PR title or description — it just adds noise;
write them as the change's own record. Pitch the title and top-line summary per
_Audience & voice_ above — a reader who knows YAML but not our internals should get
*what changed* without wading through grammar-production names or internal symbols.
Cite the spec to back a claim (linked to its section), and keep the
production-level walkthrough for the template's **Correctness note**.

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

This is what makes the pipelined per-commit review (loop step 4) safe: the single writer is the
top-level's current implement/fix subagent, and every reviewer is a **reader that works off a
committed git hash** (`git show` / `git diff <hash>`, the immutable object DB) rather than the
live tree — so the review of chunk N and the implementation of chunk N+1 overlap without racing.
A reviewer that must *run* something (tests, a repro) checks the hash out into its own
`.scratch/code-review-<name>-playground/` copy or a git worktree, never the shared tree.

### The correctness gate (this repo)

A chunk is **not done** until, as applicable: `pnpm typecheck` clean · `pnpm test`
(vitest, all green) · `pnpm test:unit` · `pnpm test:stringify` · `pnpm test:suite`
(yaml-test-suite pass rate must **not** drop) · `pnpm bench:self` shows **no** perf
regression. Never claim progress or commit on a red gate; emit fresh
`results/benchmarks/*.yaml` per the Benchmarking rules below (CI publishes real runs
to the orphan `benchmark-data` branch — nothing to commit locally).

## Versioning & releases — Changesets

Standard [Changesets](https://github.com/changesets/changesets) flow; **never
hand-edit `version`.** Every PR touching `src/` needs a changeset (`pnpm
changeset`) — CI's `changeset-check` enforces it; a `src/` change that ships
nothing to users uses `pnpm changeset add --empty`, and non-`src/` PRs need
none. Publishing is decoupled: merging the auto **"Release: version packages"**
PR lands the bump on `main`, then `publish.yml` publishes it idempotently —
don't add a `changeset publish` step.

Ordinary semver, plus two repo rules: **while pre-1.0 a breaking change is a
`minor`** (protecting `^0.x` consumers), and **`major` is gated on the 1.0
boundary** — the first `1.0.0` is the maintainer's call (never crossed
autonomously), and only *after* 1.0 may Claude pick `major`, only when certain a
documented API/behavior actually breaks (else `minor`, or ask). Contributor
details: [CONTRIBUTING.md](CONTRIBUTING.md).

**A changeset's summary *and* body flow verbatim into `CHANGELOG.md` and the
release notes — pure user-facing prose, so write them per _Audience & voice_
above:** the observable change in plain language (a tiny before/after YAML snippet
beats a paragraph of grammar productions), production names and internal mechanics
left for the PR. A spec citation is welcome — linked to its section, per _Audience &
voice_.

## Research dossier — when to read it

[site/src/content/docs/research/notes/](site/src/content/docs/research/notes/) holds the parser-strategy research
(2026-07). Do **not** re-derive or contradict it from scratch — read the
relevant file first. Skip it entirely for harness tweaks, fixtures, docs,
or dependency chores. Read it when the task touches parser design,
implementation, or performance — pick by task:

- Deciding *what* to optimize for — the real-world YAML shape / target-workload profile, graded `[MEASURED]`/`[REASONED]`/`[INFERRED]` → `2026-07-16-real-world-yaml-optimization-profile.md` (the canonical target; supersedes the older scattered "medium-and-up / JSON-shaped" asides)
- Implementing/designing parser code → `2026-07-12-design-a-pure-js-parser.md` (the recommended pure-JS design)
- Debugging slow code / optimizing a hot path → `2026-07-12-pure-js-speed-ceiling.md` + `2026-07-12-local-microbenchmarks.md` (V8 tricks: `2026-07-12-v8-json-parse-anatomy.md`)
- Writing or reviewing perf-sensitive JS (JIT tiers, monomorphism, deopt checks) → `2026-07-12-v8-optimization-guide.md`
- Comparing against js-yaml / yaml behavior or speed → `2026-07-12-js-yaml-internals.md` / `2026-07-12-eemeli-yaml-internals.md`
- Anything WASM or native → `2026-07-12-wasm-route-evaluation.md` + `2026-07-12-design-b-wasm-parser.md` (route was rejected — read before reopening)
- Before relying on a perf claim from the dossier → `2026-07-12-adversarial-verdicts.md` (three claims were refuted)
- Planning benchmarks, fixtures, stringify, or conformance work → `2026-07-12-completeness-critique.md`
- Adversarial / security / torture testing, or parser-differential work → `2026-07-12-adversarial-torture-tests.md` (its findings are locked by `test/adversarial.unit.ts`)
- Chasing `JSON.parse` / `JSON.stringify` performance → the `2026-07-14-*` performance notes (e.g. `2026-07-14-stringify-speedup-via-key-caching.md`, `2026-07-14-parse-multiline-speedup-lever.md`, `2026-07-14-memory-value-interning.md`)

When **creating or editing** a file under `site/src/content/docs/research/notes/`, follow
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

Fixtures and `results/` are gitignored; benchmark data lives on the orphan
`benchmark-data` branch (append-only), not committed to `main`.

## Benchmarking rules — read before committing

Benchmark data no longer lives in a committed file. Each emitter writes one
single-doc YAML (no leading `---`) to `results/benchmarks/<suite>.yaml` —
`speed.yaml`, `memory.yaml`, `conformance.yaml`, `bundle-size.yaml` — which is
**gitignored**: these are local, disposable artifacts, not something you commit.
The numeric source of truth is the orphan `benchmark-data` branch: on every push
to `main`, CI runs the full competition matrix and **appends** a new `---`-separated
document to the matching file on that branch. The docs site
(<https://lightning-yaml.dev>) reads the newest document per suite from
`benchmark-data`, overlaid at build time by the deploy workflow. There is nothing
to commit to `main` as part of an ordinary chunk — just make sure the emitters
still run cleanly. (The README carries only a small hand-written snapshot —
refresh it too if the representative numbers move materially; see the caveat
there about not inventing numbers.)

**Only the full competition matrix produces appendable data** — cross-library
ratios need every library measured in the same run, so `bench:self` (partial,
`ours`-only) output is never appended to `benchmark-data`; it's a fast local dev
signal only.

### 1. Before every commit or PR: refresh OUR results locally

Run:

```bash
pnpm bench:self
```

`bench:self` benchmarks only this repo's own parser (group `ours` in
`bench/candidates.ts`) plus the JSON baseline — fast, so run it every commit. It
emits `results/benchmarks/speed.yaml` + `memory.yaml` (scope `ours`) as a
gitignored local artifact — read it to check for regressions, but there is
nothing to commit. The per-fixture capability probe (`candidateHandles`) still
drops any candidate from a fixture it can't parse (so no bogus "error" rows
appear), but lightning-yaml now reads every committed category — JSON, block
`yaml-plain`, and rich `yaml-rich` (`!!binary` + `&`/`*` anchors) — so nothing is
skipped for it today. Do **not** run the (slow) full-matrix benchmark on ordinary
commits.

Also run `pnpm test` (vitest consistency vs the oracle) and `pnpm test:unit`
(the parser's own node:test suite) before committing parser changes — together
they are the correctness gate. All consistency categories — JSON, block
`yaml-plain`, and rich `yaml-rich` (`!!binary` + anchors) — currently pass; keep
them green.

Note: timings drift run-to-run — that's normal; peak-RSS / heap-Δ are the stable
figures. Run on an otherwise-quiet machine.

### 2. Re-run the head-to-head benchmark on deps, data, or a milestone

Run:

```bash
pnpm bench:competition
```

This benchmarks the **full matrix — every parser including lightning-yaml**
(scope `all`) and emits `results/benchmarks/speed.yaml` + `memory.yaml` (scope
`competition`) locally. **CI runs this same command on every push to `main`** and
appends the result onto `benchmark-data` — that's how the site's history grows;
you don't need to do anything extra locally beyond confirming it runs cleanly.
Re-run it locally (to sanity-check before pushing) when:

- **dependency versions change** — `js-yaml`, `yaml`, or `mitata` are bumped;
- **the datasets change** — fixtures added/grown or `bench/fixtures/datasets.ts`
  edited; or
- **our parser reaches a milestone** worth a fresh head-to-head sanity check (fast
  per-commit tracking of our parser alone stays local via `bench:self`).

This is the slow one (the xlarge/`yaml` cases take several minutes) — not needed
on ordinary commits (CI covers it on push to `main`).

### 3. Refresh bundle size on dependency or notable `src`-size changes

Run:

```bash
pnpm bench:bundlesize
```

This bundles each library's `parse` + `stringify` with five bundlers (Vite, Webpack,
Bun, Deno, Rolldown) — tree-shaking + minification, browser platform — and emits
`results/benchmarks/bundle-size.yaml` (gitignored local artifact; CI appends the
published copy to `benchmark-data` on push to `main`). Sizes are **deterministic**
(unlike timings), but there's still nothing to commit locally — re-run it as a
sanity check when:

- **dependency versions change** — `yaml`, `js-yaml`, or a bundler is bumped; or
- **`src/core.ts` grows/shrinks materially** — our own bundle size moved.

The bundler toolchain is isolated in `bench/bundlesize/package.json` (installed on first
run), so it never touches the root install or `pnpm typecheck`; the harness is plain
`.mjs` and excluded from the gate. Bun/Deno rows appear only when those runtimes are on
PATH. Not needed on ordinary commits. See [bench/bundlesize](bench/bundlesize/README.md).

## Notes for changes to the harness

- `bench/candidates.ts` is the single source of truth. `lightning-yaml` is
  already registered there (group `ours`), wired to `src/index.ts` — to bring it
  to life you implement `src/core.ts`, you don't touch the registry. Each
  candidate declares a `kind` (`json` vs. `yaml`); `candidateApplies` uses it
  with the dataset category to decide which candidates run for parse vs.
  stringify (e.g. JSON never parses block YAML), and `candidateSupports` skips
  candidates whose op still throws `NotImplementedError`.
- **Fixture categories** live in `bench/fixtures/datasets.ts`: `json`,
  `yaml-plain` (JSON-shaped data in block YAML, no tags/anchors), and
  `yaml-rich` (`!!binary` + `&`/`*`). The generator writes rich fixtures via the
  `yaml` library's `schema: "yaml-1.1"` stringify option — the only way that
  library exposes a `!!binary` tag writer for `Uint8Array`; it's a quirk of that
  library's option naming, not an indication the fixture text uses YAML-1.1-only
  syntax (the output stays fully 1.2-conformant, and lightning-yaml parses it like
  any other fixture). Keep YAML fixtures ≤1 MB to bound the competition
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
