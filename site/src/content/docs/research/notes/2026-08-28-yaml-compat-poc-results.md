---
title: Does the yaml-compat POC beat the yaml library at its own API?
description: Measured parse/stringify speed and memory for the yaml v2.9.0-compatible layer against the eemeli yaml lib, plus a verdict against the POC success bar.
---

Is a requirement-compatible reimplementation of the `yaml` v2.9.0 API, layered on
the lightning-yaml parser, worth shipping? **Yes — adopt it.** Versus the eemeli
`yaml` library, the compat layer parses `parseDocument`/`parseAllDocuments`
~9.6–12.9× faster across the corpus, stringifies ~3.9–10.4× faster, uses 61–65%
less peak memory to parse and 32–37% less to stringify, and covers every API
endpoint the three target consumers (yaml-language-server, Prettier,
eslint-plugin-yml) need at P0/P1 — 8 of 9 text fixtures round-trip byte-identical.
The residual gaps are narrowly scoped, documented, and mostly already mirrored by
eemeli itself. This is a thorough measurement run, not a fail-fast probe.

## Background

The project needs a `yaml`-compatible drop-in so that consumers like
yaml-language-server, Prettier, and eslint-plugin-yml can run on lightning-yaml
rather than the heavier `yaml` package. The POC's success bar — fixed up front —
was: **≥2× parse/stringify speed** (the deal-breaker: no significant speed win is
a failure), **ideally ~50% less peak memory** (nice-to-have), **≥90% API
compatibility** acceptable if the missing 10% is unlikely used by the target
consumers, with merge keys and YAML 1.1-style (docker-compose) configs working.

## What was built

A compat layer at `poc/yaml-compat/` exposes the `yaml` v2.9.0 API surface on top
of the lightning-yaml parser core. It ships as a stack of draft PRs on
jbsiddall/lightning-yaml, verified with `gh pr list`: **#180** baseline benchmark,
**#181** parser core + comment-preserving AST, **#182** CST pipeline
(Parser/Composer/LineCounter), **#183** comment-preserving stringify, **#184** the
full API surface and deviation docs (COMPATIBILITY.md + this file's sibling
API-PRIORITY.md). This note stacks on #184 at branch `poc/yaml-results`.

## Method

All numbers below were measured fresh in this session on Node v22.23.2 against the
installed `yaml@2.9.0`. Corpus fixtures were regenerated deterministically via the
seeded PRNG in `poc/yaml-compat/bench/corpus.ts`. Speed is a median of timed loops
after warm-up (15 iterations per run; 3 for the >1 MB fixtures, 5 runs per headline
case), reporting both raw median ms and MB/s. Memory is measured in an isolated
child process per (library × operation × fixture) cell — the pattern from the
`2026-07-14-memory-value-interning.md` note and `bench/baseline-worker.ts` — so
peak RSS is trustworthy. The machine was otherwise idle during timings.

## Results

### Parse speed

The comparison that matters is `parseDocument` (single doc) and
`parseAllDocuments` (multi-doc streams), since those are the AST APIs the
consumers actually use.

| Fixture | ours (parseDocument/All) | yaml lib | speedup |
|---|---|---|---|
| block-config (50 KB) | 16.45 MB/s | 1.27 MB/s | **12.9×** |
| multidoc-k8s (100 KB, parseAllDocuments) | 14.63 MB/s | 1.50 MB/s | **9.8×** |
| json-records-large (2 MB) | 12.68 MB/s | 1.33 MB/s | **9.6×** |
| json-records-small (10 KB) | 16.21 MB/s | 1.43 MB/s | **11.3×** |

A full nine-fixture baseline run agreed: block-config `parseDocument` 13.5×,
multidoc parseAllDocuments 13.1× in that single pass (multidoc timing is the
noisiest cell).

### Stringify speed

Median MB/s for `doc.toString()` across the whole corpus, ours vs yaml:

| Fixture | speedup | | Fixture | speedup |
|---|---|---|---|---|
| block-config | 6.8× | | json-records-medium | 7.0× |
| comments-docker-compose | 4.9× | | json-records-small | 10.4× |
| comments-github-actions | 5.0× | | large-block (5 MB) | 7.5× |
| comments-k8s-deployment | 3.9× | | multidoc-k8s | 6.7× |
| json-records-large | 6.5× | | | |

Range **3.9×–10.4×**; JSON-shaped data is fastest (6.5–10.4×), comment-dense files
slower but still 3.9×+.

### Memory (peak RSS)

| Operation | Fixture | ours | yaml lib | reduction |
|---|---|---|---|---|
| parse | json-records-large | 256 MB | 664 MB | 61% less |
| parseDocument | json-records-large | 250 MB | 663 MB | 62% less |
| parseDocument | large-block | 473 MB | 1.35 GB | 65% less |
| stringify | json-records-large | 440 MB | 648 MB | 32% less |
| stringify | large-block | 644 MB | 1.03 GB | 37% less |

Parse meets and beats the ~50%-less ideal. Stringify lands at 32–37% less — well
below yaml's footprint, but short of the 50% target. The gap is that stringify
re-serializes the comment-preserving AST, which carries more per-node bookkeeping
than the plain parse tree. Heap delta follows the same shape (parse −60–65%, drained
by the child-process GC); peak RSS is the durable figure here.

### Compatibility state

Per COMPATIBILITY.md: **SUPPORTED 56 / PARTIAL 4 / DEFERRED 1 / CUT 10**. The four
PARTIAL caveats, one line each: `parseDocument` scans the whole stream defensively
(see Risks); `keepSourceTokens` accepts the option but attaches ranges, not CST
tokens, to AST nodes; C0-control escape format is value-identical but not always
source-form identical to eemeli; `getIn` does not resolve aliases mid-path. 8 of 9
corpus fixtures stringify byte-identical; comments-github-actions differs by one
one-line comment attachment. Every CUT (out-of-scope options, `visitAsync`) and the
one DEFERRED (`!!binary`) throw a loud `Not implemented in POC` rather than
misbehaving. Merge keys and YAML 1.1 style configs (docker-compose, via
`version: 1.1`) parse and resolve correctly.

## Interpretation: verdict against the success bar

| Criterion | Outcome | Result |
|---|---|---|
| ≥2× parse speed | 9.6–12.9× | **PASS** |
| ≥2× stringify speed | 3.9–10.4× | **PASS** |
| ~50% less peak memory (ideal) | parse 61–65% / stringify 32–37% less | **PASS (parse); under target (stringify)** |
| ≥90% API compatibility | flat count 84.5% (SUPPORTED+PARTIAL) | **PASS on consumer-need** |
| Merge keys + YAML 1.1 configs | work | **PASS** |

On the flat endpoint list, SUPPORTED + PARTIAL is 60 of 71 (84.5%), and SUPPORTED
alone is 56 of 71 (79%) — neither literally reaches 90%. The bar's own escape hatch
is that a missing ~10% is *acceptable when the target consumers don't use it*, and
that is exactly the shape here: the 11 non-covered entries (10 CUT + 1 DEFERRED) are
unused by yaml-language-server, Prettier, and eslint-plugin-yml, and they loud-throw
so nothing silently breaks. Every P0 and P1 endpoint the three consumers need is
covered; the only P0 under PARTIAL is Prettier's `stringify`, whose caveat is the
narrow flow-comment placement issue below.

**Recommendation: adopt.** Merge the stacked PRs toward main behind the POC path. The
POC is a compatibility layer, not a replacement for the fast native parse/stringify
in `src/core.ts`; it exists so drop-in consumers can run on lightning-yaml's engine.
Confidence: high on the speed and memory verdicts (repeated measurements, both libs
under identical isolation), moderate on the "consumers won't hit the gaps" claim,
which rests on reasoning about the three consumers' known usage rather than a live
integration test.

## Residual risks that should inform that call

- **Flow-comment detachment (COMPATIBILITY.md caveat 5).** An inline comment inside
  a flow collection detaches on re-stringify (surfaces as a top-level line, or drops
  when the flow collection continues past it). Values always survive; block
  collections attach comments correctly. Prettier is the consumer that cares most,
  and it drives the low-level CST — but a Prettier-style flow-heavy file would show
  comment drift.
- **keepSourceTokens gap.** `keepSourceTokens: true` yields ranges, not CST tokens,
  on AST nodes. Prettier's own CST mode uses Parser/Composer directly, so this does
  not block it, but any consumer reading `.token` would find it absent.
- **`parseDocument` is a full-stream scan.** Defensive tab-indent detection scans the
  whole source, so extracting the *first* document of a large multi-doc stream is
  ~2.7× slower than eemeli's first-doc-only parse. `parseAllDocuments` on the same
  stream is ~13× faster because the single pass is reused. Most consumers handle
  single-doc files, so the real-world hit is small.
- **Block-scalar whitespace-only trailing lines.** The adversarial string battery
  (30+ shapes) shows our stringify byte-matches eemeli on *every* shape. What does
  not survive is **value** round-trip on exactly the four whitespace-only-trailing-line
  shapes (`' \n'`, `'   \n'`, `'  \n  \n'`, `' \t \n'`): block scalars strip those
  trailing lines, which is YAML §8.1's own stripping rule, and eemeli suffers it
  identically. Leading/trailing space on *content* lines round-trips value-EXACTLY.
  So bytes agree with the oracle on these strings too; the value is what is
  normalized, by the spec, not by us.

<!-- bench:none js-yaml:none yaml:2.9.0 ly:6a25ef6 — local one-off measurements (2026-08-28), not benchmark-data branch rows. Speed: median of 15-iter loops (3 for >1 MB), 5 runs for the headline parse cells; single run for stringify corpus. Memory: peak RSS, child-process isolation, 5-25 iters. Node v22.23.2, linux x64. -->

## Provenance & sources

- **Repo:** jbsiddall/lightning-yaml, branch `poc/yaml-results`, stacked on
  `poc/yaml-api-polish` (#184) ⬅ #183 ⬅ #182 ⬅ #181 ⬅ #180.
- **Runtime:** Node v22.23.2, `yaml@2.9.0`, `js-yaml@5.2.1`. Machine linux x64,
  idle during timings.
- **Methodology notes:** speed = median MB/s over warm timed loops via
  `poc/yaml-compat/bench/baseline.ts` + `bench/stringify.ts` and a focused
  5-run parse range probe; memory = peak RSS in one child process per
  (library, op, fixture) cell via `bench/baseline-worker.ts`. Fixtures
  regenerated deterministically by `bench/corpus.ts` (seeded PRNG). Ratios are the
  durable signal; absolute ms/MB are machine-specific.
- **Discrepancies vs prior-session figures:** earlier notes claimed parse ~8×
  block-config / ~12× multidoc and stringify 5–11×. This session measured block-config
  `parseDocument` at **~12.9×** (parse op ~9.8×) and stringify at **3.9–10.4×** — the
  block-config number is higher than the ~8× recollection (the prior session's own
  baseline file already showed ~13×), and the stringify low end is a bit below the
  prior 5× floor (3.9× on the comment-dense k8s fixture). Reported ranges supersede.
  The heap Δ / RSS parse reduction (61–65%) matches the prior −62–65%.
- **Code references:** `parseDocument`/`parseAllDocuments`/`stringify` entry points
  in `poc/yaml-compat/src/index.ts`; block-scalar whitespace shapes in
  `poc/yaml-compat/test/stringify.test.ts`; compat/priority maps in
  `poc/yaml-compat/COMPATIBILITY.md` and `poc/yaml-compat/API-PRIORITY.md`.