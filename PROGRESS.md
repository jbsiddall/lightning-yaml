# PROGRESS — lightning-yaml parser completion

Orchestrator-maintained state. North star: the official **yaml-test-suite** pass
rate. Target: OUR pass rate ≥ js-yaml's, closing the gap to `yaml`. Cases that
`yaml` itself fails are spec-corner non-goals — skip + document.

## Status snapshot

- Branch: `claude/lightning-yaml-orchestrator-ureudp` (off `main`)
- Done (pre-existing): **M0–M3** — JSON flow, YAML flow (plain scalars + 1.2 core
  typing, quoting/escapes, comments), block maps/sequences, implicit keys, compact
  forms. Adversarial-hardened (10 findings fixed).
- Gate: `pnpm typecheck` + `pnpm test` (vitest consistency vs `yaml` oracle) +
  `pnpm test:unit` (node:test). yaml-rich consistency cases red until anchors +
  `!!binary` land.

## yaml-test-suite pass rate

Suite pinned to `data-2022-01-17` (402 cases → 373 scored [282 pos / 91 neg],
29 unscorable/skipped). Run: `pnpm test:suite` (or `node --import tsx
bench/conformance/run.ts [--dump-failures]`).

| date | ours | js-yaml | yaml | notes |
|------|------|---------|------|-------|
| Phase 0 baseline | 39.4% (147/373) | 86.6% (323/373) | 97.1% (362/373) | pos 29.4% / neg 70.3% |
| F1 doc-markers/multi-doc | **49.1%** (183/373) | 86.6% | 97.1% | pos 45.0% / **neg 61.5%** (↓ leniency unmasked) |

TARGET: ours ≥ **86.6%** (js-yaml). 188 of our failures are "clearly fixable"
(both js-yaml & yaml pass); 11 are spec-corners `yaml` itself fails (skip).

### Failure buckets (primary → count)

After F1 (183/373): block-scalar **58** (now the top) · plain-scalar-typing 32 ·
anchor-alias 31 · doc-markers 29 · tag 26 · directive 2 · complex-key 7 ·
flow-only 6 · **merge-key 0** (none in this snapshot — NOT needed for target).
154 of our failures are "clearly fixable" (both js-yaml & yaml pass).

(Phase-0 baseline for reference: block-scalar 58 · doc-markers 44 · plain-scalar
35 · anchor 31 · tag 25 · directive 20; secondary co-occurrence doc-markers 108.)

### CROSS-CUTTING GAP: error-case strictness (over-lenient)

Negative/error cases: **56/91 (61.5%)** vs js-yaml 78/91, yaml 89/91. We accept
some inputs we should reject. F1 unmasked this (leading `---` used to blanket-throw
`NotImplementedError` → accidentally "passed" error cases; now we parse past it).
Closing this is required to reach js-yaml's overall rate — track as its own bucket
(inputs both competitors reject but we accept) and tighten as features mature.

## Loop log

- **Phase 0 (done, `77473c4`):** vendored yaml-test-suite (`bench/yaml-test-suite/`,
  gitignored data + `fetch.sh` with git-clone fallback), built runner
  (`bench/conformance/`: `run.ts` + `suite.ts`/`deepEqual.ts`/`classify.ts`), scripts
  `gen:suite` + `test:suite`. Baseline recorded above.
- **Baseline gate diagnostic (done):** gate is GREEN once `pnpm gen:fixtures` runs.
  typecheck clean, test:unit 143/143, vitest 37/43 (6 red = known yaml-rich only).
  The "~10 test:unit failures" were purely missing fixtures (ENOENT) — no real bug.
- **F1 · doc-markers + directives + multi-doc (done, `5e51563`):** suite 39.4%→49.1%
  (+36). Rewrote `parse`/`parseAll` over a shared `parseNextDocument` loop; cold
  directive parsers; `---`/`...` markers; one gated col-0 doc-marker terminator in
  `parseBlockMap`/`resolveBlockPlain` (flow untouched). test:unit 192/192, vitest
  unchanged (6 rich red), bench:self no regression (within GC noise). VERIFIED by
  orchestrator (independent gate + suite run).
  - Deviations (deliberate, oracle/suite-calibrated): `--- key: val` & `--- - a`
    ERROR (match yaml lib + suite 9KBC/CXX2, stricter than js-yaml); duplicate
    `%YAML` in one doc rejected (matches js-yaml + suite SF5V). Skipped spec-corners
    (not chased): EB22/RHX7 (mid-doc `%` vs next-doc directive lookahead), 2 cases.

## Next

- **Compat scaffolding** (parallel track) — both shim files + differential tests.
  Runs next as its own delegation (feature work has started, per user request).
- **F2 · block scalars** (`|`/`>`, chomping, indent indicators) — largest bucket (58).

## Feature backlog (likely order by failure-coverage)

1. M4 block scalars (`|`, `>`, chomping/indent indicators)
2. Anchors/aliases (`&`, `*`)
3. Tags incl. `!!binary`, `!!str`, etc.
4. Merge keys (`<<`)
5. Directives + `---` / `...` multi-document streams
6. stringify (design says stub-only for v1; not required for the parse pass-rate target)

## Drop-in compatibility track (PARALLEL to the feature backlog)

Goal: a codebase using `js-yaml` or the `yaml` library can swap ONE import to a
lightning-yaml compat shim and keep working, with our parser under the hood. This
runs in PARALLEL with the feature backlog; the two shim files are independent of
each other and can be built in parallel.

**Hard constraint: NO refactoring of `src/index.ts`.** The shims are thin NEW files
that delegate to our existing `parse` / `parseAll` / `stringify`. Full compat is not
expected yet — best-effort now; gaps become loop sub-items and shrink automatically
as `parse` improves.

- `src/js-yaml-compat.ts` — mirrors js-yaml v4's public API (`load`, `loadAll`,
  `dump`, `YAMLException`, schema constants) delegating to our parser. KNOWN GAP:
  js-yaml defaults to YAML **1.1** (`yes`/`no`/`on`/`off` booleans, sexagesimal,
  leading-zero octal) while we target **1.2 core** → schema-level divergences are
  expected, tracked as a sub-item, NOT forced now.
- `src/yaml-compat.ts` — mirrors the `yaml` library v2 API (`parse`,
  `parseAllDocuments`, `parseDocument`, `stringify`) delegating to our parser.
  Closer fit (both 1.2 core). Full `Document`-object fidelity (`.toJS()`, node
  classes) is partial; value-level `parse` is the priority.

**Compat TESTS (differential):** for a corpus of inputs, assert each shim's result
deep-equals the REAL library's result — both the parsed value AND throw/no-throw.
They start mostly RED, and that is intended: they feed the loop. Every ASSESS step
reports the compat pass rate (js-yaml-compat and yaml-compat) alongside the suite
pass rate, with failures grouped by cause so a single feature pick can close both at
once. Must not block the core gate (kept as a separate reporting suite).

Scheduling: begins once Phase 0 is up (suite running) and the first feature lands —
i.e. alongside feature iteration 1, as its own delegation, so its commits don't race
the feature agent's.

Compat sub-items surfaced so far: _(filled after the first compat-test run)_

## Deferred (until pass-rate target met)

- Property-based tests (fast-check)
- M7 deep perf polish

## Deviations / skipped spec-corners

- (none yet)
