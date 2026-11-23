# Optimisation techniques tracker

**Last updated:** 2026-11-23

One row per technique, not per experiment. Each row says where the technique pays off (the broadest
condition we can defend), where it loses, and what evidence we have. Experiments and verdicts live in
the [research notes](../../site/src/content/docs/research/notes/); this file links to them. The goal is
the fastest YAML library for the workloads in the
[real-world profile](../../site/src/content/docs/research/notes/2026-07-16-real-world-yaml-optimization-profile.md).

## Rules for this file

- A technique gets a verdict only with a link to evidence: a note, a benchmark run, or a PR.
- `untested` means reasoned, not measured. Do not cite it as an advantage.
- No numbers in this file. Numbers live in the notes, with provenance markers.
- Engine rows (T1–T6) were checked against V8 behaviour as documented in the
  [V8 guide](../../site/src/content/docs/research/notes/2026-07-12-v8-optimization-guide.md). Re-check
  them when the Node major version changes.

**Status vocabulary**

| Status | Meaning |
| --- | --- |
| `shipped` | In `src/` and either measured or documented in a note |
| `promising`, `situational`, `not-worth-it`, `inconclusive` | The verdict of the linked note |
| `untested` | Reasoned only. Not an advantage yet |
| `shelved` | Started, then stopped on a decision. Detail is outside the repo |
| `in use` | A practice we follow, not a code change |

**Correction to a premise.** V8 does not compile JavaScript to C. It JIT-compiles to machine code in
tiers (see the V8 guide, §1). JavaScript has no parameter types for V8 to read. V8 learns types and
object shapes from what actually runs. So the rule is not "declare parameter types". It is "keep the
runtime types and object shapes the same at each call site". An object parameter is fine if it always
has the same shape. `this` is fine if it always has the same shape. What hurts is variation.

## A. Engine: how V8 runs our code

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T1 | Keep runtime types and object shapes stable at each call site | Any function on the hot path: scanner, node builders, emitter | More than four shapes at one call site (polymorphic inline-cache limit). A variable that changes type in a hot loop | `untested` | V8 guide TL;DR and §2. Check with `node --trace-opt --trace-deopt` |
| T2 | Build records with the same keys in the same order | Many objects of the same kind (mappings, records) | `delete`, keys added after creation, conditional keys (each variant gets its own shape). A `Map` for a small fixed shape costs more to build | `situational` | [fixed-shape mapping objects](../../site/src/content/docs/research/notes/2026-08-10-memory-fixed-shape-mapping-objects.md) |
| T3 | Keep array element kinds homogeneous | Result arrays holding only numbers, or only objects | Holey arrays from `new Array(n)` then fill: push onto a fresh `[]` instead. Mixing numbers and strings in one array | `untested` | V8 guide (element kinds) |
| T4 | Keep hot code free of deopt triggers | Every hot function | Reading past the end of an array. `arguments`. `delete`. `with`, `eval`, `new Function` | `untested` | Check with `--trace-deopt` on the bench fixtures |
| T5 | Keep hot functions small. Move cold error paths out | Per-character and per-token functions | Code that never tiers up: a small one-shot document runs only in the interpreter and baseline tiers. Tuning cold code for the top tier | `untested` | V8 guide TL;DR and §1 |
| T6 | Check tier residency in CI | Any change to the scanner | Timing-based checks are flaky. Use the engine's flags instead | `untested` | V8 guide §7 (planned, not built) |

## B. Scanning the input

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T7 | Read the string with `charCodeAt`, not `str[i]` | Per-character scanning | None found | `shipped` | `src/core.ts` (`charCodeAt` throughout); V8 guide §3 |
| T8 | Character-class lookup table (`Uint8Array`, bit flags) | Many character-class tests in the scanner | One or two comparisons. A table rebuilt per call | `shipped` | `CH` table in `src/core.ts` |
| T9 | Hop long runs with `indexOf` or other native search | Long runs of plain characters with rare stops (plain scalars, quoted content) | Short runs: call overhead dominates. A windowed regex run once per quoted scalar | `situational` | PR #338. The windowed-regex variant looked slower than a plain check on quote-dense input. One spot check. Five-round A/B pending |
| T10 | Keep the input as a JS string. Do not decode bytes first | Almost always: callers pass strings | Callers that hold bytes (fetch bodies) pay the decode cost once. Decode share is small for ASCII and larger for CJK. A byte-scan prototype ran slower than the string scan | `not-worth-it` for a byte-level core | [V8 optimization guide §3](../../site/src/content/docs/research/notes/2026-07-12-v8-optimization-guide.md) (per-slice `TextDecoder` costs more than `str.slice`). Bytes-in result is scratch, note pending |

## C. Building output and other per-call work (evaluated in notes)

Each of these has a verdict in its note. The note says the conditions. Read the note before reopening one.

| ID | Technique | Verdict | Note |
| --- | --- | --- | --- |
| T11 | Map-key render cache (stringify) | `promising` | [note](../../site/src/content/docs/research/notes/2026-07-14-stringify-speedup-via-key-caching.md) |
| T12 | Block-scalar ConsString accumulator (parse) | `promising` | [note](../../site/src/content/docs/research/notes/2026-07-14-parse-multiline-speedup-lever.md) |
| T13 | One-scan scalar-style classifier (stringify) | `inconclusive` | [note](../../site/src/content/docs/research/notes/2026-07-14-stringify-multiline-one-scan-classifier.md) |
| T14 | String value interning (parse) | `situational` | [note](../../site/src/content/docs/research/notes/2026-07-14-memory-value-interning.md) |
| T15 | Array-join vs ConsString rope (stringify) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-stringify-string-building-rope-vs-join.md) |
| T16 | Hand-rolled number parsing (parse) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-parse-number-conversion-cost.md) |
| T17 | Hand-rolled number formatting (stringify) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-stringify-number-formatting-cost.md) |
| T18 | Single-pass optimistic dumper (stringify) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-stringify-speedup-via-single-pass-dumping.md) |
| T19 | Input-length pre-parse gate (parse) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-parse-length-based-path-selection.md) |
| T20 | Tiny-document fixed overhead (parse) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-parse-tiny-document-overhead.md) |
| T21 | `Object.freeze` on parsed output (memory) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-memory-object-freeze-effects.md) |
| T22 | Columnar store and proxy facade (memory) | `not-worth-it` | [note](../../site/src/content/docs/research/notes/2026-07-14-memory-columnar-store-and-proxy-facade.md) |
| T23 | Fixed-shape mapping-object construction (parse) | `situational` | [note](../../site/src/content/docs/research/notes/2026-08-10-memory-fixed-shape-mapping-objects.md) |

## D. Native shortcuts

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T24 | Try native `JSON.parse` first for JSON-shaped input. Fall back to the YAML parser on throw | Input is JSON, or JSON-only YAML, and holds one document. Config files and API payloads are common cases | Parity: for what we accept, the result must match YAML 1.2. Duplicate keys: `JSON.parse` keeps the last value, which must be a listed deviation before we rely on it. `__proto__` keys. Comments, tags, anchors and multi-document input must take the fallback. Cost on YAML input: `JSON.parse` rejects at the first non-JSON character, which should be cheap, but measure it on yaml-plain fixtures | `untested` | None yet. [INFERRED]: js-yaml and yaml do not delegate to `JSON.parse`. Verify against their source before claiming it |
| T25 | Use native `JSON.stringify` for JSON-style output | The caller asks for JSON-compatible output | YAML output must stay YAML. Check that escaping and number formatting match before using it | `untested` | None yet |

## E. Memory and retention

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T26 | Do not keep the input string after parsing | Always | None. The parser's module-level `src` is set in `resetForStream` and not cleared when parsing returns, so the last input stays in memory until the next parse | `untested` (fix not yet made) | `src/core.ts`: `let src` and `resetForStream`. Confirm with a heap check, then clear it on return |
| T27 | Flatten a small kept value cut from a large source | You keep a small value from a large source for a long time: lazy access, caches, editor state | V8 slices keep the whole parent string alive. Short slices are copied anyway. A flattening copy costs time per kept value. Pointless for values you drop straight away | `untested` in repo. Scratch test: the parent string is released, note pending | Lazy-get Phase 0 work. Note pending |
| T28 | Cache the parse of identical input | The same document is parsed again and again: editor or reload | Caching belongs to the caller, not hidden in the library. Comparing two equal strings costs a full scan. The cache holds the input | `situational` | Scratch measurement: repeat parses of unchanged text become nearly free. Document as caller advice, not a hidden cache |

## F. Lazy and incremental access

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T29 | Lazy `get` by path: scan only the path asked for | A few paths out of a large document: editor hover, config lookups | Paths through sequences are blocked in the corpus tested. Coverage in that corpus was too low to justify the work. Guard cost is paid per call | `shelved` | Owner decision pending. Plan and evidence are outside the repo |
| T30 | Batch several `get` paths into one scan | One document, several paths | Depends on T29. The gain is only the guard cost, shared across paths | `untested` | None yet |
| T31 | Incremental re-parse of an edited region | Editor sessions with small edits | Edits that cross multi-line scalars or anchors. High correctness risk | `untested` | None yet |

## G. Packaging and bundle size

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T32 | `sideEffects: false` in `package.json` | Every ESM build | Any module-level side effect blocks tree-shaking for that module | `shipped` | `package.json` |
| T33 | Named per-feature exports (parse, stringify, get, and so on) instead of one options-taking function | Consumers who use only part of the API | One function that takes options keeps the code for every option in the bundle. Named exports let bundlers drop the rest. Needs ESM and no module-level side effects. Costs a little extra when every export is used | `untested` | `pnpm bench:bundlesize` measures this per bundler (Vite, Webpack, Bun, Deno, Rolldown). Owner accepts small growth. No size budget set yet |

## H. Measurement practice

| ID | Technique | Worth doing when (broadest) | Skip when / trap | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| T34 | Interleaved A/B with a second baseline arm (main-A, head, main-B, head), run several rounds under one lock | Any performance claim near the noise floor | Single runs drift by tens of percent. The second baseline arm shows the noise floor | `in use` | [PR #338](https://github.com/jbsiddall/lightning-yaml/pull/338) |

## Candidate advantages over the competition

Not yet claims. Each needs a verified comparison with the competing library before we say it out loud.

1. **Native `JSON.parse` delegation (T24).** Potentially the largest gap on JSON-shaped input. Needs parity testing first.
2. **Named exports that tree-shake (T33).** Only an advantage if the competitors' bundles are larger for the same feature set. Measure, don't assume.
3. **Stringify key render cache (T11) and multi-line block-scalar parse (T12).** Both are `promising` in their notes. Neither is shipped.
4. **Retention (T26, T27).** We currently hold the last input. Fix it first. Then compare retained memory against competitors on the same input.

## Next actions, in order

1. Spike T24 on the JSON fixtures. Measure the failure cost on yaml-plain fixtures. Write the parity cases before the code.
2. Do T26: clear `src` on return from `parse`. Confirm with a heap check.
3. Prototype T33 on a branch. Run `pnpm bench:bundlesize`. Compare against the bundle sizes we measured before.
4. Add a tier-residency check for the scanner (T1, T6). Start with the engine flags.
5. Write notes for the lazy-get, bytes-in and retention work, so rows T27–T29 and T10 link to a note, not scratch.

## Decisions needed from the owner

- Bundle-size budget for T33: how much growth is acceptable when a consumer gets every export?
- Whether T29 (lazy get) stays shelved.
