---
title: "lightning-yaml v1 design — a single-pass, allocation-minimal, pure-JS YAML parser engineered for V8"
---
> Produced by a multi-agent research session (Claude Code). All local numbers were measured on the session container — Node v22.22.2 / V8 12.4, 4-vCPU Xeon 2.80 GHz, 16 GB RAM; absolute MB/s are machine-specific, ratios are the durable signal. Referenced `scratchpad/*.mjs` scripts were session throwaways and are not committed.

## lightning-yaml v1 — Design (Brief A: pure-JS, C-style)

## 0. Goal, scope, and the one-sentence thesis

Parse YAML (core schema, block + flow, anchors/aliases, js-yaml-`load`-compatible surface) to plain JS values, sync, Node >= 20, clearly beating js-yaml on speed AND peak RSS, approaching `JSON.parse`.

**Thesis:** js-yaml already proves single-pass direct composition is the right architecture (it beats eemeli/yaml ~15-20x purely by having zero intermediate representations — dossier: eemeli discussion #358; local: js-yaml 23-29 MB/s vs yaml 1.5-2.0 MB/s). Its remaining 5.7-7.1x deficit vs `JSON.parse` (local a-parsers.mjs table) is **constant-factor waste**: per-scalar resolver chains, double validation scans, per-node/per-pair allocations, string-materialized numbers, and speculative probe framing (js-yaml weaknesses #1-#12, loader.js cites throughout). The dossier's 166-line minijson parser removed exactly those categories for JSON and hit **98-104 MB/s = 57-60% of native `JSON.parse` and 3.9x js-yaml on identical bytes** (scratchpad/minijson.mjs, deepStrictEqual-verified). lightning-yaml is "minijson, generalized to YAML, without giving the constant factor back."

Out of scope for v1: stringify (stub), streaming/async, custom schemas/tags API, YAML 1.1 sexagesimals/`yes/no/on/off` booleans, CST/comments retention (that is eemeli/yaml's 73x-memory tax; explicitly never in our parse path).

---

## 1. Scanning substrate: flat JS string + `charCodeAt` + `indexOf`; no bytes, no copies

**Decision: parse the input JS string directly.** Evidence:
- Byte scanning has **zero** advantage on this machine: Uint8Array loop 1,253 MB/s vs string `charCodeAt` 1,255 MB/s (local bench b). And bytes force materialization through `TextDecoder.decode(subarray)` at **124-150 ns/call fixed overhead** vs `str.slice` at **7-11 ns** (local bench e; pure-JS dossier bench2) — an ~11x per-token penalty on exactly the operation a YAML parser does most (short keys/scalars). The earlier "bytes 1.5x faster" result did not reproduce here; the local measurement on this Node 22.22.2 is authoritative.
- `String.prototype.indexOf` runs at ~5 GB/s (V8-native memchr/SIMD class) vs ~0.5-1.25 GB/s for any JS char loop (pure-JS bench1). This is our legal substitute for V8's Highway SIMD string scan (V8 T8, json-parser.cc:2090-2127) and is why the handrolled JSON parser **beat native** on string-heavy input (1,393 vs 1,057 MB/s, bench3).
- Input from `fs.readFileSync`/typical sources is a flat SeqString; `charCodeAt` on flat is 513 vs 356 (Sliced) vs 301 MB/s (Cons) (bench2). We do not defensively flatten (no cheap reliable way); we document "pass a normal string" and note ConsString input degrades ~40%, never breaks.

**No pre-parse copies.** js-yaml makes 1-2 full input copies + a full `indexOf('\0')` scan before parsing byte one (`String(input)`, `+= '\n'`, `+= '\0'`, loader.js:1720-1752). We do none: bounds via a hoisted `len` local and `pos < len` loop conditions (V8 eliminates redundant bounds checks); BOM handled by starting `pos = 1` when `charCodeAt(0) === 0xFEFF` — no slice. On a 10 MB doc this alone saves ~20 MB of transient allocation and one full scan.

**Character classification: one `Uint8Array(256)` bit-flags table**, the direct analog of V8's `character_json_scan_flags[256]` (json-parser.cc:104-137; V8 T2 verdict "fully replicable"). Bits: `SPACE_TAB`, `EOL`, `FLOW_INDICATOR` (`,[]{}`), `DQ_SPECIAL` (`"` `\` and C0), `DIGIT`, `PLAIN_UNSAFE_FLOW`, `PLAIN_UNSAFE_BLOCK`, `WS_OR_EOL`. Local bench1: table lookup 306 MB/s vs if-chain 264 vs switch 258 for multi-way classification — a modest but free win, and it replaces js-yaml's per-char predicate *function calls* (`isWsOrEol` etc., loader.js:31-52). Non-ASCII: all YAML indicator chars are ASCII, so `code > 127 ⇒ not special`; codes 128-255 are zero-flagged in the table and codes > 255 read out-of-bounds as `undefined`, and `(undefined & BIT) === 0` is the correct "not special" answer. (If profiling ever shows the OOB read confusing the JIT, gate with `code < 256 ? FLAGS[code] : 0`; measure, don't assume.) A second 128-entry table maps double-quote escape chars to their decoded char codes (js-yaml's `simpleEscapeMap` and V8's escape table, both precedent).

---

## 2. Architecture: tokenizer-less recursive descent, char-dispatched, many medium monomorphic functions

**No tokenizer, no CST, no AST — readers build final JS values directly.** This is js-yaml's winning move (loader.js:1410, 1014, 1085 — `_result` IS the output) and eemeli/yaml's fatal omission (4 stages, 733 MB CST for 10 MB input, generator plumbing at ~58 ns/lexeme; its Lexer *alone* takes 3x js-yaml's whole parse). Every "minimal token layer" proposal must clear this bar: 3.86M lexemes for 10 MB means even 20 ns/token of overhead is ~77 ms — more than `JSON.parse`'s entire 71-80 ms. So: zero tokens, ever.

**Dispatch on the current char; never trial-chain readers.** js-yaml tries blockSeq → blockMap → flowColl → blockScalar → ' → " → * → plain per node (loader.js:1506-1532) and wraps every block-level scalar in an extra speculative `readBlockMapping`+`composeNode` frame pair with a snapshot allocation each (loader.js:1145, 1455-1457 — weakness #7, #4). We switch once on `charCodeAt(pos)`:
- flow context: `{` `[` `"` `'` `*` `&` `!` digit `-` `+` `.` → dedicated parsers; default → flow plain scalar.
- block context (at line content start): `-`+ws → seq entry; `?`+ws → explicit key; `|` `>` → block scalar; else → scalar-or-implicit-key (Section 4).

**Parser state: module-level monomorphic scalars, values returned by `return`.** State is `let src: string, pos: number, len: number, lineIndent: number`, plus lazily-touched `anchorMap: Map|null`, `docEnd/flags` ints. All ints stay SMI. There is **no god-object with a polymorphic `result` field** — js-yaml's `state.result` alternates string/array/object/null and gets fields added post-construction, going polymorphic at every IC (weakness #12, loader.js:175-183). Our parse functions return their value; string accumulation happens only in function-local variables. Module-level state was validated at ~100 MB/s in minijson (bench c). Consequence: the parser is non-reentrant — acceptable because the API is fully sync with no user callbacks in v1; `parse()` resets state on entry so a previously thrown error can't poison the next call.

**Function structure: many medium functions, one job each.** V8's inlining budget is 460 bytecode per inlinee (920 cumulative), functions <= ~30 bytecode inline nearly always, and **any function over 60 KB bytecode is never TurboFan-optimized**; deopts discard the whole containing function's code (V8 flag-definitions.h:1589-1615, pure-JS dossier §3). So: no megafunction. Inventory (hot): `parseDoc`, `parseFlowValue` (the dispatch switch), `parseFlowMap`, `parseFlowSeq`, `parseDoubleQuoted`, `parseSingleQuoted`, `parseFlowPlain`, `parseBlockNode`, `parseBlockMap`, `parseBlockSeq`, `parseBlockPlain`, `parseBlockScalar`, `resolvePlain`, `parseNumberSpan`, `skipFlowWs`, `skipToLineContent`, `storePair`. Cold, out-of-line, never inlined into hot callers: `fail()` (error construction — computes line/col by counting newlines in `src.slice(0, pos)` ONLY on throw, js-yaml's one good lazy-error idea, loader.js:192, minus its bug of copying the whole input into the Mark), `decodeDqEscapes`, `parseTagOrAnchorProps`, `applyMergeKey`, `resolveTimestamp`, `parseDirectives`. V8 does recursion + stack-limit fallback (T3); we use plain recursion with a `depth` counter and a hard limit (~1,000, configurable) that throws — YAML docs nested deeper are an attack, not a use case (js-yaml 4.3.0 added the same guard).

**Hot paths allocation-free.** The only allocations while parsing are: result objects/arrays, result strings (slices), boxed doubles, and — on rare paths only — a parts array for multi-segment scalars and the escape decoder's output. No per-node snapshot (js-yaml 4.3.0 allocates a 9-field object for virtually every node, loader.js:1455-1457), no per-mapping `Object.create(null)` overridableKeys (loader.js:1086, 771), no per-pair `delete` (loader.js:446), no closures, no per-doc tag/anchor maps unless a `&`/`*`/`%TAG` is actually seen (pay-on-first-use, weakness #11).

---

## 3. Scalar pipeline

### 3.1 Capture: offsets first, slice once, never re-validate
Scan records `(start, end)` integer offsets (V8 T4: zero-copy `JsonString{start,length,...}` records, json-parser.h:29-98). Materialization:
- **Single-segment scalar (the overwhelming case): exactly one `src.slice(start, end)`.** At >= 13 chars this is an O(1) SlicedString (V8 `SlicedString::kMinLength = 13`, string.h; local: 7.1 ns at len 20, cheaper than the 11.1 ns copying 8-char slice — bench e).
- **Multi-segment** (escaped strings, folded multi-line scalars): collect part slices in a local array, `parts.join(sep)` — not repeated `+=` rope-building (js-yaml does one slice+concat per line + a hand-rolled `repeat` loop, loader.js:370, 1005, common.js:31-39; eemeli does `res += ch` per character, resolve-flow-scalar.js:118-173).
- **No second validation pass.** js-yaml re-scans every captured segment (charCode re-loop for quoted, `PATTERN_NON_PRINTABLE.test` regex for plain/block — loader.js:358-366, weakness #1). We validate structurally during the single scan via the flags table; C0-in-quoted validation is folded into the scan loop variant (Section 3.4) — never a separate pass, never a regex.

### 3.2 Implicit typing: first-char dispatch, zero regex, zero intermediate strings
js-yaml runs up to 6 polymorphic `Type.resolve` calls with 3 regex-engine invocations per plain scalar (loader.js:1566-1577; float.js:27; timestamp.js:24-25 — weakness #2). Honest calibration: the local d-typing bench showed regex-vs-charCode dispatch is only 1.14x (54.5 vs 47.7 ns) — so this is a real but second-order win; the architecture is the first-order win. We still take it, because our version also eliminates the string materialization that js-yaml pays *before* typing.

`resolvePlain(start, end)` switches on `charCodeAt(start)` with length gates:
- `n/N` and len 4 → charCode-compare `null/Null/NULL`; `~` len 1 → null; empty span → null.
- `t/T` len 4 → `true/True/TRUE`; `f/F` len 5 → `false/False/FALSE`.
- digit, `-`, `+`, `.` → `parseNumberSpan` (3.3); on failure fall through to string (and, if the js-yaml-compat timestamp mode is on: digit-start && len >= 8 && `charCodeAt(start+4) === 45` gates `resolveTimestamp`, cold).
- `.` len 4 / sign+4 → `.inf/.Inf/.INF/.nan/...` forms.
- `<` len 2 → merge sentinel (checked only in key position).
- anything else → `src.slice(start, end)`.
All compares are raw `charCodeAt` — a non-string scalar **never allocates a string at all** (js-yaml always slices first, loader.js:356). Quoted scalars skip resolution entirely (same as js-yaml, loader.js:1551).

Schema stance: YAML 1.2 core schema semantics (0x hex, 0o octal, no `0b`, no `_` separators, no sexagesimal) — js-yaml itself deviates from 1.2 here (nodeca/js-yaml#627), so exact bug-for-bug parity is neither possible nor desirable; deviations from js-yaml get documented and covered by differential tests. js-yaml's *default* schema extras (timestamp → `Date`, merge `<<`) are implemented but first-char-gated cold paths, per the scope requirement of js-yaml-`load` compatibility.

### 3.3 Numbers: V8's Smi trick in JS
`parseNumberSpan(start, end)` (V8 T5, json-parser.cc:1835-1861 — "fully replicable"):
- Optional sign; then accumulate `v = v * 10 + (c - 48)` while digits. Up to 15 significant digits this is exact in a double and int32-range results are Smis — **zero allocation, zero string**. This closes minijson's biggest gap (numbers were its 2.6x-slower-than-native case).
- On seeing `.` / `e` / `E`: continue a *shape-validating* charCode scan to the end of span (digits/exponent structure only), then convert with `+src.slice(start, end)`. The pre-validation matters: `Number()` accepts `"Infinity"`, `"0b101"` etc., which must remain strings in core schema — `Number` is the converter, never the validator.
- `0x`/`0o` prefixes: dedicated accumulate loops.
- Non-number shape at any point → return sentinel, caller falls back to string.
Contrast: js-yaml materializes the string, then parses ints 2-3x (validate loop + `parseInt` in resolve + `parseInt` again in construct, int.js:52,89,115-117) and floats with regex + `parseFloat` x2 + a `toLowerCase()` allocation (float.js:27-51 — weakness #3). We parse each number exactly once, from the source, allocating only when it's genuinely a float.

### 3.4 Double-quoted strings: indexOf hops + memoized rare-char positions
The fast path (this is what made minijson beat native on strings):
1. `e = src.indexOf('"', q + 1)`.
2. Memoized `nextBackslash` and `nextNewline` (recomputed via `indexOf` only when the memo falls behind the cursor — the bench3 memo pattern that fixed an O(n²)).
3. If `e < nextBackslash && e < nextNewline`: value is `src.slice(q + 1, e)` — one slice, done. This covers ~100% of JSON-shaped input.
4. Otherwise, cold `decodeDqEscapes`: segment-capture between escapes (slice runs, escape table for `\n \t \" \\ ...`, manual `\xNN \uNNNN \UNNNNNNNN` with surrogate pairs), YAML line-folding for multi-line double-quoted, `parts.join('')`.
C0-control validation on the fast path is deferred to the conformance milestone with a measured decision: a validating flags-table loop scans at ~1,255 MB/s (~0.8 ns/char) vs indexOf at ~5 GB/s — worst case on an all-string 10 MB doc it costs ~8 ms; if the yaml-test-suite demands it (error cases with raw control chars), we fold it in and remain native-class on strings. Ship as a `strict` toggle if the suite tolerates leniency; the dossier notes rapidyaml ships documented deviations while passing 100% — precedent for pragmatism, but suite results decide.

Single-quoted: `indexOf("'")` hop; `''` doubling handled by peeking the next char and looping (multi-segment join on hit).

### 3.5 Block scalars (`|`, `>`)
Header parse (chomping `+ -`, explicit indent digit), then line loop: `nl = src.indexOf('\n', pos)` per line (5 GB/s hopping), indent check via charCode loop over the (short) indentation prefix, one slice per content line into a parts array, `join('\n')` for literal or folding-aware join for folded. No `common.repeat`-style `+=` loops.

---

## 4. Block structure: the implicit-key problem without speculative frames

The block-mapping ambiguity ("is this line a scalar or a `key: value`?") is where js-yaml pays two `composeNode` frames + two snapshot objects per block-level scalar (loader.js:1145, 1178-1188 — weakness #7). Our approach exploits a spec fact: **implicit keys must fit on one line (and are capped at 1,024 chars)**. `parseBlockNode` at a content char:
1. Dispatch on char. For quoted/flow-collection/alias/tagged starts: parse the node (single scan), then skip spaces and peek — `:` + (ws|EOL) ⇒ it was a key: enter `parseBlockMap` with `(keyValue, indent)` pre-parsed; otherwise it's the node itself. No re-parse, no state snapshot, no backtrack — the parsed value is used either way.
2. For plain scalars, even better: the block-plain scan *already* stops at `':' + ws/EOL` (that's the plain-scalar termination rule). So when the scan halts on a colon, we know it's a key immediately; if it halts at EOL, it's a scalar (possibly multi-line — continuation handled by `parseBlockPlain`'s line loop: each following line's indent is computed by `skipToLineContent`, continuation requires indent > parent and non-indicator start; folding via parts+join).
3. `skipToLineContent` is the single place newlines/indent/comments are handled in block context: after each `\n`, count leading spaces (charCode loop over a short run), set `lineIndent`; `#` → `indexOf('\n')` hop; tabs-as-indent → cold `fail`. Line/column bookkeeping does not exist outside this function (js-yaml's same discipline, loader.js:452-510, kept; its always-on `firstTabInLine` bookkeeping, dropped — tabs are detected where they matter).
`parseBlockSeq`: `-` + ws, recurse at child indent; same-line compact forms handled by dispatching directly. Explicit `? :` keys: cold path.

Document layer: `%` directives (cold parse, `%YAML 1.2`/`1.1` accepted, `%TAG` stored lazily), `---`/`...` recognized only when `lineIndent === 0` and first char is `-`/`.` (one charCode gate before the 3-char check — js-yaml's `testDocumentSeparator` runs far more often). `parse()` = single document (throws on a second doc, like js-yaml `load`); `parseAll()` loops documents reusing all state. Trailing newline is NOT required (js-yaml copies the input to append one; we just treat EOF as EOL).

---

## 5. Building results for V8

- **Objects:** plain `{}`, keys assigned in encounter order → hidden-class sharing across homogeneous mappings is automatic (v8.dev/fast-properties; V8 T6 verdict: the *effect* of map feedback is reproducible this way). Duplicate keys: last-wins by plain assignment — JSON.parse semantics, which js-yaml itself adopts under `json: true` (its default per-pair `hasOwnProperty` x2 + `delete overridableKeys[key]` is weakness #5; we do none of it). `__proto__` guarded by a `charCodeAt(0) === 95` gate (then full compare → `Object.defineProperty` cold path) so the check costs ~1 compare for 99.9% of keys vs js-yaml's per-pair string compare (loader.js:121-133).
- **Key interning (bench4: fresh-sliced keys are 3.3x slower to assign than interned — 127 vs 39 ms/300k objects):** a per-`parse()` `Map<string, string>` key cache. On key capture: slice, `keyCache.get(s)` → reuse the first-seen (already-internalized, hash-cached) string, else set. This makes repeated keys `===`-identical, amortizing internalization and making transition walks cheap across the thousands of records in our fixtures. Per-parse (not global) so it can't grow unboundedly across documents.
- **M7 upgrade — key feedback, the V8 FastKeyMatch analog (T6, json-parser.cc:1074-1087, "the single most transferable idea"):** parent sequence contexts pass the previous element's key list; `parseFlowMap`/`parseBlockMap` first byte-compare the upcoming key's chars against the expected next key (`key.charCodeAt(i)` vs `src.charCodeAt(pos+i)`, ~1.6 ns/char, no slice, no hash, no Map probe). On full sequential match the object is built with the identical shape and zero key allocations. Fixtures are arrays of homogeneous records — hit rate ~100%. Ship behind a micro-benchmark gate: adopt only if it beats the plain intern cache measurably.
- **Arrays:** built with `push` — stays PACKED; `new Array(n)` is HOLEY forever and sequence lengths are unknown mid-parse anyway (bench4 + v8.dev/elements-kinds). Int fast path emits Smis → number-only sequences become PACKED_SMI automatically; no contortions to keep kinds pure (mixed-push cost ≈ smi-push cost, bench4).
- **Anchors/aliases (pay-on-first-use):** `anchorMap` is `null` until the first `&` (weakness #11 — js-yaml allocates per-doc anchor/tag maps always, loader.js:1627-1628). `&name` registers the container object in the Map *immediately after allocation, before children parse* → cycles (`&a [*a]`) work. `*name` is `Map.get` → **the same reference**, O(1) — js-yaml's model, and the exact thing eemeli/yaml got 138x-slower wrong pre-2.8 (discussion #358; PR #612). Merge `<<`: resolved-key-sentinel triggers cold `applyMergeKey` (existing keys win, js-yaml semantics), gated on first char `<`.
- **Tags:** `!` triggers cold `parseTagOrAnchorProps`; core `!!str/int/float/bool/null/map/seq` resolved by name compare; js-yaml-default extras (`!!binary`, `!!set`, `!!omap`, `!!pairs`) in the compat layer (M5); unknown tags throw (documented).

---

## 6. Flow-collection fast path (the benchmark path)

Fixtures are JSON bytes, so `parseFlowValue`/`parseFlowMap`/`parseFlowSeq` must be minijson-tight. Per element, the entire cost is: one `skipFlowWs` (flags-table loop; also handles `#` comments via `indexOf('\n')` and enforces the flow-in-block indent rule only when a newline was actually consumed — zero cost on single-line JSON), one dispatch switch, the value parse, one terminator check (`,` `]` `}`). YAML-only generality is paid **only when its trigger char appears**: `':'`-after-element single-pair-map detection is one `=== 58` compare (never taken on JSON input — after a JSON value comes `,` or a closer); anchor/tag/alias are switch cases that JSON input never hits; plain-scalars-in-flow are the switch default. Compare js-yaml's flow path: 3x `skipSeparationSpace`, full `composeNode` with tag/anchor probes + snapshot alloc, and pair-detection machinery per element (loader.js:797-854 — weakness #6). The block path shares the scalar pipeline (Section 3) and value builders (Section 5) but has its **own** entry functions and its own whitespace/indent skipper — we deliberately do not unify flow and block scanners behind flags, because per-char mode checks are exactly the generality tax we're eliminating; the cost is some code duplication, controlled by sharing the leaf parsers.

---

## 7. Why this wins peak RSS, not just speed

The eemeli investigation's meta-lesson: **peak RSS tracks allocation rate, not live set** (yaml@2 hit 4.3 GB RSS with ~1.15 GB ever live; 25-iter loops: yaml 4,302 MB, js-yaml 564 MB, JSON 643 MB there; README baseline: 282 / 495 / 2,630 MB). So the RSS strategy IS the allocation strategy. Per-category vs js-yaml on a 10 MB doc:
- Input copies: js-yaml ~2 full copies + full scan (loader.js:1720-1752) → **0**.
- Per-node: 9-field snapshot object (4.3.0) → **0**. Per-mapping `Object.create(null)` → **0**. Per-pair dictionary `delete` churn → **0**.
- Numbers: intermediate slice + `toLowerCase` copy per float → **0 for ints, one slice per float**.
- Scalars: slice + rope concat + regex pass → **one slice** (parts array only for escaped/multiline).
- Keys: fresh slice per occurrence → **one slice per distinct key per document** (intern cache), approaching zero with M7 feedback.
Our allocation volume ≈ output value graph + epsilon ≈ `JSON.parse`'s profile. Expected 25x10MB peak RSS: **within ~1.1-1.3x of JSON.parse's, i.e. roughly 300-450 MB territory vs js-yaml's 495-564 MB (~25-45% lower), vs yaml's 2.6-4.3 GB (~10x lower)**. `heap Δ` (iteration-independent, per CLAUDE.md the stable figure) should land at JSON-class values since the retained output is the same object graph. Known caveat, documented: scalar slices >= 13 chars are SlicedStrings pinning the source (~10 MB) while results are alive — irrelevant to the harness (results dropped per iteration; source alive during parse anyway), relevant to users retaining results long-term; a `copyStrings: true` escape hatch can flatten on capture if ever needed (js-yaml has the same behavior via `'' + slice`, so this is not a competitive regression).

---

## 8. Implementation plan

Structure: `src/` TypeScript (erasable types only; runs under tsx like the harness; `pnpm typecheck` covers it), `src/index.ts` exporting `parse` / `parseAll`.

- **M0 — harness hookup (day 1).** Add candidate `{ name: "lightning-yaml", group: "ours", parse }` at bench/candidates.ts:49-51. `bench:self` runs both parse and stringify benches (bench/report.ts:57, 102-115), so make `Candidate.stringify` optional and have `stringify.bench.ts` skip candidates without it (harness change → run `pnpm typecheck`; per CLAUDE.md this does NOT trigger bench:competition — no dep/dataset change). From this point `pnpm bench:self` is run and its README block committed with every commit, per CLAUDE.md.
- **M1 — JSON-subset flow parser.** `{} [] "..." numbers true/false/null`, flags table, indexOf string fast path, Smi number path, intern cache. Exit: `deepStrictEqual` vs `JSON.parse` on all 5 fixtures + escape/unicode/bignum torture set; **bench:self shows >= ~90 MB/s on large-records** (within ~10% of minijson — if not, fix before adding YAML).
- **M2 — flow YAML.** Plain scalars in flow + `resolvePlain`, single quotes, comments, `:`-pairs in seqs, `?` keys, empty values (`{a}`). Exit: fixture parity intact, regression budget < 5% vs M1.
- **M3 — block structure.** `skipToLineContent`, block maps/seqs, implicit-key resolution (Section 4), multi-line plain scalars, nesting, compact forms. Exit: differential vs js-yaml on a generated block-YAML corpus (round-trip fixtures through `jsYamlDump`, parse both, deepEqual); block throughput sanity target >= 50 MB/s.
- **M4 — block scalars** `|`/`>` with chomping/indent indicators and folding.
- **M5 — full surface.** Anchors/aliases/cycles, merge keys, tags (core + js-yaml-default extras), directives, `---`/`...`, `parseAll`, timestamp compat mode. Exit: alias-heavy stress (Stripe-style yarn.lock shape) stays O(n).
- **M6 — conformance.** Vendor yaml-test-suite (gitignored data, fetch script like fixtures). Harness: run suite for ours AND js-yaml under identical comparison rules; report both pass rates. Target: **>= js-yaml's pass rate** (js-yaml fails part of the suite itself; matching-or-beating it is the honest v1 bar — 100% is a non-goal shared with rapidyaml, which documents deviations). Every deviation gets a line in README. Add JSON-fuzz (ours vs JSON.parse) and YAML-fuzz (ours vs js-yaml, structure-aware generator) to CI.
- **M7 — perf polish.** Key feedback (Section 5), `--cpu-prof` on fixtures, `--trace-deopt` / `--allow-natives-syntax` opt-status checks on hot functions, IC-state audit. Each optimization gated on a measured bench:self delta. Dependency bump or fixture change here → re-run `bench:competition` per CLAUDE.md.

Testing infra throughout: `node:test` unit suites per milestone; fixtures deepStrictEqual gate in CI; bench:self output committed per the repo's benchmarking rules.

---

## 9. Quantified expectations (derived in §"expected_performance")

Summary: **3-3.5x faster than js-yaml on the JSON-bytes fixtures (75-95 MB/s vs 23.6-26.7 MB/s), 0.45-0.6x JSON.parse (134-182 MB/s), with string-heavy documents at parity-or-better vs native; block YAML ~3-4.5x js-yaml (est. 55-80 MB/s vs 18.1 MB/s); peak RSS within ~1.1-1.3x of JSON.parse and ~25-45% below js-yaml.** Full derivation chain in the expected_performance field.

## 10. Explicit non-goals / rejected alternatives

- **WASM route: rejected.** Its own dossier concludes 1.5-2x over js-yaml at best (transcode-to-JSON path, still 3-4.5x JSON.parse), with a permanent never-shrink linear-memory RSS floor (verified +99 MB permanent), packaging drag, and per-node boundary costs (~200 ms/10 MB) that make the direct-object path a non-starter. Pure JS reaches the same speed class with none of that.
- **Bytes/TextDecoder substrate: rejected** on local measurements (Section 1).
- **Token/event layer, CST, document API: rejected** — that's the measured 15-100x eemeli tax. A rich-document API, if ever wanted, must be a separate opt-in parser, never in `parse()`.
- **Regex anywhere on the hot path: rejected** (only second-order per bench d, but it also forces string materialization, which is first-order).

## EXPECTED PERFORMANCE
All ratios below come from measurements on the target machine (Node 22.22.2, V8 12.4, Xeon 2.80GHz — local micro-benchmark dossier) and are relative, so they should survive machine changes better than absolute MB/s.

DERIVATION CHAIN, speed on JSON-bytes fixtures (the benchmark):
(1) Measured floor/ceiling: js-yaml.load = 23.6-26.7 MB/s across 1KB-10MB; JSON.parse = 134.5-182.4 MB/s (a-parsers table). (2) Measured pure-JS ceiling with the exact techniques this design specifies: minijson = 98-104 MB/s = 57-60% of native on flat fixtures, 76% on nested, 3.9x js-yaml on identical bytes, deepStrictEqual-verified (bench c). (3) YAML generality tax on the flow path: per-element extras are one ':' compare, switch cases never taken on JSON input, comment gate inside ws-skip, anchor-map null check — an estimated 10-25% per-node overhead vs minijson (bounded above by the fact that every extra is a predicted-not-taken compare, not an allocation or call). ⇒ Expected: 75-95 MB/s on flat records = 2.9-3.7x js-yaml and 0.45-0.6x JSON.parse; commit publicly to ">=2.5x js-yaml, ~3x typical". On the nested fixture the ratio to native improves (native drops to ~128-140 MB/s while recursive-descent JS holds — minijson was 76% of native there). On string-heavy documents the indexOf-hop technique measured FASTER than native (1,393 vs 1,057 MB/s, bench3), so "at or above JSON.parse" is honest for that content class only — and that claim must carry the caveat. Small-doc (1KB): JSON.parse has a 5.3 µs/call floor, js-yaml 35.7 µs; with zero per-call setup allocations expect ~9-14 µs = 2.5-4x js-yaml.

Block YAML (not in the committed benchmark but strategically required): js-yaml measured 18.1 MB/s (bench5). We remove its double composeNode framing + snapshot allocs (per-node), 6-resolver/3-regex typing (~50 ns/scalar, bench d), second validation pass, and per-pair map churn; raw scanning is only ~8% of the budget at 1,255 MB/s, so block overhead is mostly the same materialization work as flow. Estimate 55-80 MB/s = 3-4.5x js-yaml — lower confidence (no minijson analog exists for block mode; flagged as a risk).

MEMORY (25 x 10MB harness metric): peak RSS tracks allocation rate (eemeli dossier: yaml 4,302 MB RSS with only ~1.15 GB live; js-yaml 495-564 MB; JSON 282-643 MB across the two measurement sets). Our allocation volume per parse ≈ output graph + one slice per scalar/distinct key + rare parts arrays — the same category profile as JSON.parse, having eliminated every js-yaml-specific category (2 input copies, per-node snapshot objects, per-mapping Object.create(null), per-pair delete churn, intermediate number strings, float toLowerCase copies). ⇒ Expected peak RSS within ~1.1-1.3x of JSON.parse's on the same harness run, i.e. ~25-45% below js-yaml and ~10x below yaml; heap Δ at JSON-class values (retained output is the same object graph; ours ~= JSON's 22 MB rather than js-yaml's 51 MB for the 10MB doc, modulo SlicedString pinning of the ~10 MB source while results are held).

Net headline vs the repo's committed baselines: parse speed ~3x js-yaml / ~0.5x JSON.parse on the fixtures (with parity-or-better on string-heavy content), peak memory at JSON-class, both with ~4x measured headroom over the bar "clearly beats js-yaml" (minijson already demonstrated 3.9x on this machine).

## KEY ASSUMPTIONS
- The benchmark remains JSON-bytes/ASCII fixtures (bench/fixtures/datasets.ts), so the flow-collection fast path dominates the committed numbers; block-YAML estimates are extrapolated, not measured, and datasets may later grow block-style cases.
- minijson's measured 57-60%-of-native (98-104 MB/s, 3.9x js-yaml) transfers to the YAML flow parser with no more than ~10-25% generality tax — i.e., YAML's extra checks can genuinely be kept to predicted-not-taken compares with zero hot-path allocations.
- V8 behaviors measured on Node 22.22.2 hold across Node >=20 and near-future V8: SlicedString/ConsString kMinLength=13 with O(1) slice, ~5 GB/s indexOf, flat-string charCodeAt speed, hidden-class transition sharing for same-order keys, and no advantage for Uint8Array scanning.
- The competitive target is js-yaml 4.x as installed (4.3.0); js-yaml 5.x (June 2026 TypeScript rewrite) has not been benchmarked here and is assumed not to be dramatically faster than 4.x.
- Peak RSS in the memory harness is governed by allocation rate plus live output (as measured for all three competitors), so eliminating js-yaml's per-node/per-pair allocation categories is sufficient to reach JSON-class RSS without engine-level control.

## RISKS
- Block-mode complexity erosion: implicit keys, multi-line plain folding, indentation edge cases and tabs rules have no minijson-measured analog; if their handling leaks checks into shared leaf parsers, the flow-path numbers regress. Mitigation: strictly separate flow/block scanners (accepting code duplication) and a per-milestone <5% regression budget enforced by bench:self.
- Conformance-vs-speed tension at M6: yaml-test-suite error cases (C0 chars in quoted scalars, 1024-char implicit-key limit, doc-markers inside scalars, tab rules) may force validation into hot loops; quantified worst case is ~0.8 ns/char (validating table loop at ~1,255 MB/s) — tolerable, but many small additions compound; the 'match js-yaml's pass rate, document deviations' bar may draw criticism vs full-conformance parsers.
- Moving target: js-yaml 5.2.1 (full TS rewrite, 2026-06) is unmeasured here and the repo still pins ^4.1.0; if 5.x meaningfully improved the loader, the '3x faster' headline shrinks and must be re-validated when deps are bumped (which per CLAUDE.md triggers the competition re-bench).
- Engine coupling: the design is tuned to V8 (slice cliff at 13, indexOf SIMD, Smi arithmetic, hidden-class transitions); JSC/SpiderMonkey (browser nice-to-have) and future V8 versions may shift ratios — e.g., JSC rope behavior differs — so browser claims must stay unquantified until measured; two-byte (non-ASCII-heavy) inputs are also unmeasured.
- SlicedString retention: scalar slices >=13 chars pin the entire source string while parse results are retained by users (not by the harness); could surface as real-world memory complaints and needs documentation plus a possible copyStrings option, which would cost speed if made default.
- Module-level mutable parser state is non-reentrant: safe for the sync, callback-free v1 API, but becomes a footgun if plugins/callbacks or re-entrant use are ever added; entry-point state reset must be bulletproof against mid-parse throws.
- Semantic compatibility deltas vs js-yaml (YAML 1.2 core numbers vs js-yaml's nonstandard int forms per nodeca/js-yaml#627, timestamp/merge defaults, unknown-tag behavior) may break drop-in replacement for some users even when 'more correct'; differential fuzzing will enumerate them but each is a support/adoption decision.