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
6. stringify

## Deferred (until pass-rate target met)

- Property-based tests (fast-check)
- M7 deep perf polish

## Deviations / skipped spec-corners

- (none yet)
