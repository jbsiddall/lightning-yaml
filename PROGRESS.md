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
| F1 doc-markers/multi-doc | 49.1% (183/373) | 86.6% | 97.1% | pos 45.0% / **neg 61.5%** (↓ leniency unmasked) |
| F2 block scalars | **62.2%** (232/373) | 86.6%→94.9%¹ | 97.1% | pos 62.4% (+49) / neg 61.5% (flat) |
| ↑ js-yaml **v5** upgrade | 62.2% (unchanged) | **94.9%** (354/373) | 97.1% | js-yaml v5 default schema → 1.2 CORE |
| F3 anchors/aliases | 67.6% (252/373) | 94.9% | 97.1% | pos 68.8% (+18) / neg 63.7% (+2). vitest 6→3 red |
| F4 tags + `!!binary` | **76.1%** (284/373) | 94.9% | 97.1% | pos 79.4% (+30) / neg 65.9% (+2). **vitest 43/43 GREEN** ✓ |

¹ **TARGET MOVED. js-yaml upgraded v4.3.0 → v5.2.1** (user request): v5's default
schema is now YAML-1.2 CORE (was 1.1-ish), so js-yaml jumped 86.6%→**94.9%**. Our
new bar is **ours ≥ 94.9%**, i.e. essentially matching `yaml` (97.1%). 119 of our
failures are now "clearly fixable" (both competitors pass); 11 are spec-corners
`yaml` itself fails (skip).

**js-yaml v5 scores 100% on NEGATIVES (91/91)**; ours is 56/91. Closing the error-
strictness gap (35 cases we wrongly accept) is now MANDATORY, not optional — see
Known bugs. Each feature agent must also make its construct's malformed forms ERROR.

### Failure buckets (primary → count)

After F4 (284/373, 89 failures, **80 clearly-fixable**): **plain-scalar-typing 32** ·
**doc-markers 27** · complex-key 7 · block-scalar 7 (residual) · flow-only 6 · tag 5
(residual) · anchor-alias 3 (residual: 4JVG/KSS4/ZWK4) · directive 2. merge-key 0.

The two big buckets (plain-typing 32, doc-markers 27) are NOT new constructs — they're
typing/boundary BUGS needing diagnosis (some likely shared root causes). complex-key (7)
IS a real unimplemented feature (explicit `? key` / `: value`; still NotImplementedError)
and also blocks residual tag/anchor cases (2XXW/35KP/L94M/ZWK4).

(Trajectory: Phase-0 block-scalar 58/doc 44/plain 35/anchor 31/tag 25/dir 20 →
F1 plain 32/anchor 31/doc 29/tag 26 → F2 plain 32/anchor 30/doc 27/tag 26 →
F3 plain 32/doc 27/tag 26/anchor 10 → F4 plain 32/doc 27/complex 7/tag 5/anchor 3.)

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

- **Compat scaffolding (done, `df458a2`):** see Drop-in compatibility track above.
  Both shims + differential runner + 21-test wiring guard. Core gate unaffected.
- **F2 · block scalars (done, `59ee233`):** suite 49.1%→62.2% (+49, all positive; neg
  flat = no strictness regression). `parseBlockScalar` (~L1676): header (indent digit +
  chomp either order), auto-indent detect, literal/folded with the more-indented
  newline-count rule, tab-in-indent error, `--- |` root interaction fixed. test:unit
  250/250, vitest 6 rich red (byte-identical), bench:self flat (cold path). compat
  block-scalar bucket ~60→16/13. VERIFIED by orchestrator. Oracle-calibrated (not
  spec-prose). Deviation/known: surfaced a PRE-EXISTING bug (see Known bugs).

- **F3 · anchors/aliases (done, `45b1f1f`):** suite 62.2%→67.6% (+20; pos +18, neg +2).
  Lazy per-doc `anchorMap`, register-before-children (cycles), same-ref aliases, extensible
  node-properties seam for F4 tags. Strictness: undefined/empty alias & alias-with-props
  error. anchor bucket 30→10 (rest need tags/explicit-keys). **vitest 6→3 red — the 3
  "anchor sharing" cases went GREEN.** test:unit 277/277, bench:self flat. VERIFIED.
  Skipped corners: 4JVG, ZWK4 (explicit keys), KSS4 (pre-existing multiline-dq).

- **F4 · tags + `!!binary` (done, `a068629`):** suite 67.6%→76.1% (+32). Tag-first &
  tag+anchor both orders via F3's seam; `!!binary`→`Uint8Array`; `%TAG` handle resolution;
  typing override; core-tag strictness. **vitest 43/43 FULLY GREEN — rich-consistency STOP
  condition MET.** test:unit 325/325; no hot-path bench regression. VERIFIED. Tag bucket
  26→5. Flagged pre-existing bugs: 9HCY (directive-ordering), FH7J (`parseDeferredBlockNode`
  seq-value), empty-dash-comment seq — all pre-date F4.

## STOP-condition tracker

- [x] yaml-rich consistency cases GREEN (vitest 43/43) — met at F4.
- [ ] ours suite pass rate ≥ js-yaml (94.9%) — at 76.1%, need +70.
- [x] full gate green (typecheck + test + test:unit) — currently green.

## Next (milestone checkpoint at F4, then continue)

- **Milestone checkpoint (NOW):** (1) opus diagnostic+fix pass on the two big buckets
  (plain-typing 32 + doc-markers 27) + the 3 flagged pre-existing bugs — find shared root
  causes, fix genuine bugs vs oracle (not new features), tighten negatives; (2) then
  `bench:competition` refresh (justified: v5 dep change + rich-feature milestone).
- **F5 · explicit `?`/`:` block keys** (complex-key 7 + unblocks 2XXW/35KP/L94M/ZWK4).
- **Negative-strictness pass** (neg 60/91 vs js-yaml 91/91 — 31 gap; biggest single lever
  after plain-typing since js-yaml v5 rejects ALL invalid inputs).
- flow-only (6), residual block-scalar (7), directive (2).

## Known bugs (pre-existing, to fix in a cleanup / adversarial pass)

- Empty dash + comment sequence entries mis-parsed (surfaced during F2; reproduces with
  ZERO block scalars — pre-existing, not an F2 regression). Costs ≥1 suite case.
- Error-case strictness gap (neg 56/91 vs js-yaml 78): we accept inputs both competitors
  reject. Address as features mature + a dedicated strictness pass.

## js-yaml v5 upgrade detail (DONE, `995d68d`)

Done. `js-yaml` ^5.2.1, `@types/js-yaml` removed (v5 bundles types). API accommodations:
no default export (→ `import * as`), `Type`/`Schema.extend` → factory fns/`withTags`,
`DEFAULT_SCHEMA`→`YAML11_SCHEMA`, `load('')` throws, option renames — all in
`src/js-yaml-compat.ts` + `test/compat.unit.ts` (shim/harness only; parser untouched).
Target moved 86.6%→94.9%. compat schema-1.1 bucket → **0** (our 1.2-core shim now fully
agrees with v5's 1.2 default). test:compat js-yaml-compat 59.7% overall. Gate green.
Re-run `bench:competition` at the next milestone checkpoint (js-yaml v5 competitor).

Original plan (for reference)
  (reinstall mid-feature-run would corrupt that agent's live js-yaml tests). js-yaml is
  our north-star baseline + benchmark competitor + compat target, so:
  - bump `js-yaml` → `^5.2.1`; **remove `@types/js-yaml`** (v5 ships its own types —
    conflict risk); `pnpm install`.
  - fix any v5 API breaks in `bench/candidates.ts`, `bench/conformance/{run,compat}.ts`,
    `test/parser.unit.ts` (`agreeWithJsYaml`); re-point `src/js-yaml-compat.ts` to mirror
    v5's public API.
  - RE-MEASURE: new js-yaml suite pass rate (**the target may move off 86.6%**) + new
    `test:compat` baseline vs v5. Re-run `bench:competition` at the next milestone.
  - The `yaml` oracle stays 2.9.0 (already latest) — this is a js-yaml-only bump.

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

Status: shims + differential runner landed (`df458a2`). Run: `pnpm test:compat`.
Files: `src/js-yaml-compat.ts`, `src/yaml-compat.ts`, `bench/conformance/compat.ts`,
`test/compat.unit.ts` (21 tests green; NOT in the core gate). Core gate unaffected
(typecheck clean, test:unit 192/192, vitest 6 rich red) — VERIFIED.

Compat baseline (agree = value deep-equal OR both throw):
| shim | read (curated 64) | read (suite 402) | dump | overall |
|------|------|------|------|------|
| js-yaml-compat | 81.3% | 50.7% | 0% (stub) | 48.6% |
| yaml-compat | 84.4% | 51.2% | 0% (stub) | 49.2% |

Read-side failure buckets (close automatically as the parser gains features):
block-scalar ~60, anchor-alias 34, tag 27, multi-doc 27, quoting ~29, plain-typing
~30. dump=0% is by design (stringify stub). **schema-1.1 divergence is NEARLY EMPTY
(2/0):** js-yaml v4 already dropped most 1.1-isms (`yes`/`no`/`on`/`off`, sexagesimal,
legacy octal, `_` separators all stay strings = our 1.2-core); only `0b` binary and
timestamp→Date actually differ. So NO 1.1 schema layer is needed for high js-yaml
fidelity — the earlier "inherent divergence" worry is largely moot.

ASSESS henceforth reports `pnpm test:compat` alongside the suite pass rate.

NOTE: all of the above (incl. the schema-1.1 finding) was measured against js-yaml
**v4.3.0**. Upgrading to js-yaml **v5.2.1** is queued (see Next) and will re-measure.

## Deferred (until pass-rate target met)

- Property-based tests (fast-check)
- M7 deep perf polish

## Deviations / skipped spec-corners

- (none yet)
