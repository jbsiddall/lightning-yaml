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

| date | ours | js-yaml | yaml | notes |
|------|------|---------|------|-------|
| (pending Phase 0) | — | — | — | harness not built yet |

## Loop log

- **Phase 0 (in progress):** vendor yaml-test-suite + build runner (ours vs
  js-yaml vs yaml, grouped failures).

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
