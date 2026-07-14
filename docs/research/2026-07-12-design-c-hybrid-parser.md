> Produced by a multi-agent research session (Claude Code). All local numbers were measured on the session container — Node v22.22.2 / V8 12.4, 4-vCPU Xeon 2.80 GHz, 16 GB RAM; absolute MB/s are machine-specific, ratios are the durable signal. Referenced `scratchpad/*.mjs` scripts were session throwaways and are not committed.

# Design C — Pragmatic hybrid: JSON.parse delegation + tiered fast-path routing inside a single-pass pure-JS YAML parser

# Design C — Pragmatic hybrid / fast-path routing

## 0. Thesis

Design C is not a separate parser. It is **Design A (single-pass, direct-composition, pure-JS recursive descent) plus an explicit routing discipline** at three granularities:

- **Tier 0 (document):** a ~30-line router that delegates whole documents that are provably-attemptable JSON to native `JSON.parse`, falling back to the full parser on any `SyntaxError`.
- **Tier 1 (subtree):** inside the full parser, flow collections (`{...}`/`[...]` at any depth) run in a dedicated JSON-shaped scanner with extra switch arms for YAML-only syntax — dispatch, never speculate-and-rewind.
- **Tier 2 (token):** escape-free quoted strings via `indexOf` + single slice; SMI integer accumulation; first-char-gated implicit typing; key interning + previous-sibling key feedback.
- **Tier 3 (deferred):** pay-on-first-use anchors, error line/col only on throw, comments skipped never stored; lazy *value* materialization considered and rejected.

Everything below is grounded in the research dossier and in two local verification scripts run for this design (`/tmp/claude-0/-home-user-lightning-yaml/5b5afb90-7c63-5a56-af0b-8798d3e9b488/scratchpad/edgecases.mjs`, `.../routercost.mjs`, Node v22.22.2).

---

## 1. Semantic contract first (or the fast paths are lies)

A router is only sound if every path produces the same value for the same input. So v1 fixes semantics **before** routing:

> **lightning-yaml v1 semantics = YAML 1.2 core schema, materialized exactly as ECMAScript `JSON.parse` would materialize the equivalent JSON** — IEEE-754 doubles (so `-0` stays `-0`, `1e999` → `Infinity`), plain objects with `Object.prototype`, `__proto__` as an own data property, last-wins duplicate keys by default.

This is a deliberate choice of *spec-faithful* over *bug-for-bug js-yaml-compatible*, forced by measured js-yaml deviations (edgecases.mjs/routercost.mjs):

| input | `JSON.parse` | `js-yaml.load` (4.3.0) | YAML 1.2 core | **ours** |
|---|---|---|---|---|
| `-0` | `-0` | `0` (sign lost) | float/int `-0` | `-0` |
| `1e999` | `Infinity` | **string** `"1e999"` | float overflow → Inf | `Infinity` |
| `1e2` | `100` | `100` | float | `100` |
| `9007199254740993` | `9007199254740992` | `9007199254740992` | int (dbl-rounded) | same |
| `{"__proto__":{"x":1}}` | own prop, no pollution | own prop, no pollution (loader.js:121-133) | n/a | same (both are already safe — verified) |
| `{"a":1,"a":2}` | `{a:2}` | **throws** (`duplicated mapping key`) | must be unique (error) | `{a:2}` default; `duplicateKeys:"error"` option |

**Duplicate keys is the one real policy fork.** JSON.parse is last-wins (ECMA-262); js-yaml default throws but its own `json:true` option switches to last-wins (loader.js:437-438 skipped); eemeli `yaml` throws (`Map keys must be unique`, verified); the YAML spec demands uniqueness. Precedent for last-wins-while-conformant: rapidyaml passes 100% of the yaml-test-suite *with duplicate keys permitted as a documented deviation* (dossier §WASM, rapidyaml README) — i.e. the suite does not gate on uniqueness enforcement. **Default: `duplicateKeys: "last"`** (matches JSON.parse, the repo's own baseline, and libyaml/rapidyaml practice). `duplicateKeys: "error"` disables Tier 0 (JSON.parse cannot detect duplicates — a reviver sees only the collapsed object) and enables one `key in obj` check per pair in the full parser. This deviation from js-yaml's *default* is documented and listed as a risk.

Other v1 scope decisions: single document per `parse()` (multi-doc throws like js-yaml; `parseAll` later); comments skipped; anchors/aliases as O(1) shared references (js-yaml `anchorMap` model, loader.js:1382 — the eemeli #358 Stripe case, 50ms vs 6,900ms, shows aliases must never deep-copy or re-resolve); `<<` merge keys supported, gated on first-char `<` (dossier weakness #2); **timestamps stay strings** (core schema; js-yaml's *default* schema turns `2021-01-01` into `Date` — divergence documented, schema option later).

---

## 2. Tier 0 — the JSON.parse delegation router

### 2.1 Mechanics

```js
export function parse(src, opts) {
  if (fastPathAllowed(opts)) {                    // duplicateKeys !== "error", no reviver-like hooks
    let i = 0, c = 0;
    while ((c = src.charCodeAt(i)) === 32 || c === 9 || c === 10 || c === 13) i++;
    if (c === 123 /* { */ || c === 91 /* [ */) {  // necessary precondition for JSON
      try { return JSON.parse(src); } catch { /* fall through */ }
    }
  }
  return fullParse(src, opts);                    // Design A
}
```

Why this exact shape, with measured costs (routercost.mjs, this machine):

- **The first-char sniff is mandatory, not an optimization.** A *failed* `JSON.parse` costs **~4–6 µs** regardless of doc size (6.1 µs on a 31 B block doc, 3.8 µs on 10 MB — the cost is SyntaxError construction, not scanning). js-yaml parses the entire 952 B fixture in 36 µs (dossier §micro); our full-parse target for 1 KB block YAML is ~10 µs — an unconditional `try` would tax every small block-YAML document 40–60 %. The sniff costs **11.7 ns** and rejects essentially all real-world block YAML (which starts with a letter, `-`, `%`, or `#`, never `{`/`[`).
- **Sniff is `{`/`[` only.** Top-level scalar docs (`42`, `"hi"`) are also valid JSON but tiny and rare; widening the gate buys nothing and adds analysis surface.
- **Whitespace pre-skip uses JSON's whitespace set only** (space/tab/CR/LF). BOM, `%` directives, `---` markers are *not* skipped — they either fail the sniff or make `JSON.parse` throw, both of which route to the full parser. This makes the gate **fail-safe by construction**: there is no input where delegation silently fires on a document JSON.parse cannot legally own.

### 2.2 Correctness analysis — honest version

The delegation soundness argument has two halves:

**(a) Acceptance direction — automatic.** Every YAML-only construct (comments, anchors `&`/aliases `*`, tags `!`, single quotes, plain scalars, block scalars, directives, `---`/`...`, multi-doc streams, BOM, trailing anything) is a JSON syntax error. Verified explicitly: `{"a":1} # hi`, `{"a":1}\n...`, `{"a":1}\n---\n{"b":2}`, `{"a": &x 1}`, `﻿{"a":1}` all throw from `JSON.parse` (edgecases.mjs) → fall back. **There is no false-positive delegation path.** The only cost of a near-miss is time (§2.3).

**(b) Value direction — for inputs both accept, do values agree?** Enumerated exhaustively:

- **Numbers**: JSON grammar ⊂ YAML core float/int; both go through correct decimal→double conversion. JSON rejects the YAML-only forms (`01`, `.5`, `+1`, `0x1F`, `.inf`) so they can't reach delegation. `-0`, `1e999`, 17-digit ints agree with *our* contract (they disagree with js-yaml — in our favor, see §1 table).
- **Strings**: JSON's escape set and semantics are a subset of YAML double-quote escapes with identical meanings; lone-surrogate `\udead` accepted identically by both (verified). Raw DEL/C1 control chars (`0x7F`, `0x9F`) are outside YAML's `c-printable` but **both** JSON.parse *and* js-yaml accept them (verified) — delegation matches the incumbent; strictness here would be a conformance option, not a default.
- **Objects/arrays**: plain objects with `Object.prototype`; `__proto__` handled identically-safely by both (verified: own property, no pollution). Deep nesting: V8's JSON.parse falls back to an iterative continuation-stack parser (v8-release-76; json-parser.cc:1277-1283) — delegation actually handles *deeper* documents than js-yaml 4.3's `maxDepth` guard.
- **Duplicate keys**: the one true divergence — resolved by policy in §1.
- **Tabs**: JSON inter-token tabs are legal YAML flow separation; both accept `{\t"a":\t1}` (verified). Not a divergence.

Conclusion: with `duplicateKeys:"last"` as the defined semantics, **Tier 0 is a genuinely correct optimization, not an approximation** — and it doubles as a free differential-testing oracle (§7).

### 2.3 Cost/benefit (measured)

| scenario | cost | frequency |
|---|---|---|
| real JSON doc (fixtures; `.json` fed to a YAML loader) | ≈ `JSON.parse` + 12 ns → 84 ms for 10 MB, 114 MB/s in-process | the entire current benchmark; common in OpenAPI/Swagger-style pipelines where `.json` specs go through the YAML loader |
| block YAML (real world default) | 11.7 ns sniff, no try/catch entered | dominant real-world case |
| flow-style YAML with YAML-only features, small | sniff + ~4–6 µs failed parse | uncommon |
| **adversarial**: 10 MB valid-JSON prefix + ` # comment` at the end | **92.6 ms wasted** (full native scan then throw), then full parse → total ≈ 1.5–1.7× the no-router time | rare (hand-annotated JSON-shaped files); accepted and documented; no cheap pre-verification exists — detecting a trailing comment requires string-aware scanning ≈ parsing |

### 2.4 Benchmark ethics — answered straight

The repo already flags this (README.md:141-146: *"Input is flow-style JSON … A block-YAML variant (via `yaml.stringify`) could be added later for an apples-to-YAML view"*). Shipping Tier 0 and pointing at the current fixture table would mean **our "YAML parser" number is `JSON.parse`'s number** — a true statement about a real input class, but not evidence of a fast YAML parser. Position:

1. **Delegation is a legitimate product feature** — JSON-through-YAML-loader is a real, common path (JSON ⊂ YAML 1.2 is the very premise of the repo's fixture design, datasets.ts:5-7), and no pure-JS parser will ever beat native on it (pure-JS ceiling measured at 57–76 % of native, dossier §micro (c)).
2. **It is not legitimate as the headline.** Legitimacy requires, concretely:
   - **Add block-style datasets** to `bench/fixtures/datasets.ts` (same seeded data, serialized via `yaml.stringify`, e.g. shapes `records-block`/`nested-block`) — this is the "datasets change" that triggers a full `bench:competition` re-run per CLAUDE.md rules.
   - **Report two rows for ours**: default (router on) and `delegation:off` (env/option toggle in the `candidates.ts` registration), so the README shows the full parser beating js-yaml *on its own* on both styles.
   - **The win condition is the block-style table**: full parser must clearly beat js-yaml where delegation never fires. If it doesn't, C has failed regardless of the flow numbers.

---

## 3. Tier 1 — flow-mode scanner inside the full parser

js-yaml's flow path is its weakest (dossier weakness #6): per element it pays 3× `skipSeparationSpace`, a full `composeNode` with tag/anchor probes, a per-node 9-field snapshot allocation (4.3.0, loader.js:1455-1457), pair-detection logic even for plain array elements, and per-mapping `Object.create(null)` + per-pair `hasOwnProperty`×2 + `delete` (loader.js:437-446, 771, 797-854). That's ~10 calls + several allocations per element where one switch dispatch suffices.

Design: `parseFlowValue(pos)` — a minijson-style tight scanner (the 166-line calibrator hit 98–104 MB/s = 57–76 % of native on the actual fixtures, deepStrictEqual-verified; dossier §micro (c)) with **additional switch arms** for YAML-only flow syntax: `'` single-quoted, plain scalars (with flow-indicator stop set), `&`/`*`/`!`, `? ` explicit keys, omitted values, comments. Two rules:

- **Dispatch, don't speculate.** No "try JSON subtree, rewind on failure": rewind would have to unwind anchor registrations and error state, and buys nothing — the extra switch arms cost zero when not taken (branch never dispatched), whereas js-yaml pays its generality per element even on pure-JSON input. This is V8's own T2/T6 philosophy (flags table + feedback, not backtracking).
- **Same value-composition machinery as block mode** (push-built packed arrays, interned keys, shared hidden classes) so flow-in-block subtrees (`tags: [a, b]` — ubiquitous in real YAML) get the full benefit. This is where Tier 1 pays off in the real world, not just on the fixtures.

## 4. Tier 2 — token-level fast paths (both modes)

All justified by dossier measurements; these belong to Design A and are listed here because C's routing story depends on them:

1. **Escape-free double-quoted strings**: `indexOf('"', pos)` (≈5 GB/s native memchr vs 0.5 GB/s charCodeAt loop) + memoized next-backslash check → single `slice` (O(1) SlicedString ≥13 chars, `SlicedString::kMinLength=13` in v8 string.h; 7.1 ns vs TextDecoder's 124–141 ns). This is how the calibrator *beat* native JSON.parse on string-heavy input (1393 vs 1057 MB/s). Kills js-yaml's per-segment re-validation loop (loader.js:358-365).
2. **Integers**: `v = v*10 + (c-48)` SMI accumulation, `Number(slice)` only for floats/long runs — V8's own kMaxSmiLength trick (json-parser.cc:1835-1861). Kills js-yaml's string-materialize-then-parse-2-3× path (type/int.js:52,89,115-117).
3. **Plain scalars**: one `Uint8Array(256)` stop-class table for the end-scan (weakness #8), then **first-char-gated typing inline with the scan** — digit/`-`/`+`/`.` → numeric; `t/f` → true/false; `n/~`/empty → null; `<` → merge; else string. Zero regexes. Honest calibration: the dossier's d-typing bench shows regex-vs-charCode dispatch is only 1.14× — the win is not the regexes, it's deleting js-yaml's 6-resolver polymorphic chain + double scan + double parse *architecture* (loader.js:1566-1577).
4. **Keys**: intern cache (fresh-sliced keys cost 3.3× vs interned when building objects — bench4) + **previous-sibling key feedback** (T6-lite of V8's FastKeyMatch, json-parser.cc:1074-1087): in a sequence of homogeneous mappings, byte-compare the key at the cursor against the previous mapping's nth key; on match, skip slice+intern entirely and preserve insertion order → shared hidden classes for free.
5. **Structure**: recursion with a depth cap; many medium monomorphic functions (V8 inlining budgets: 460-bytecode inlinee, 60 KB never-optimize ceiling — flag-definitions.h); result arrays built with `push` (stays PACKED); one input, zero pre-copies (no NUL-append/`String(input)`/BOM-slice churn — js-yaml does 1–2 full copies + a full scan before byte one, loader.js:1720-1752; we bounds-check with `pos < len` and treat `charCodeAt` NaN→out-of-range at EOF).

## 5. Tier 3 — lazy / deferred work

**Deferred (do):**
- Line/col + error snippets computed **only on throw** by re-scanning (js-yaml already does this right — loader.js:186-198 model, minus its slice-the-whole-input bug).
- **Anchor machinery pay-on-first-`&`**: no `anchorMap` allocation, no per-node anchor-null checks until the first `&` is seen (kills weakness #11's 4 checks/node).
- Comments: cursor hop via `indexOf('\n')`, never stored.
- Doc markers/directives: checked only when a line starts at column 0 with `-`/`.`/`%`.
- Duplicate-key checking: only in `duplicateKeys:"error"` mode.

**Considered and rejected — lazy scalar materialization** (getters/proxies that slice on first access): changes observable semantics (`Object.keys`, `deepEqual`, spread), wrecks hidden-class sharing and IC monomorphism for every consumer, and the benchmark (and any real consumer) touches every value anyway. The peak-RSS metric also punishes it: SlicedString-based lazy values pin the whole source string in long-lived results. Not v1, likely never.

## 6. Is JSON mode useful for real-world YAML?

Split verdict, honestly:
- **Tier 0 (document-level)**: rarely fires on real YAML (block-style). Its real-world value is the JSON-fed-to-YAML-loader pipeline (OpenAPI/Swagger tooling, tools accepting `.json|.yaml` through one loader) — genuine but narrow. Its benchmark value is large, which is exactly why it must not be the headline (§2.4).
- **Tier 1/2 (subtree/token-level)**: fire constantly on real YAML — flow lists as leaf values, quoted strings, numbers, repeated mapping shapes in `-`-lists (the k8s/CI shape). This is where C earns its keep outside the fixture matrix, and these tiers live inside the full parser, benefiting block documents where JSON.parse can never help.

## 7. Composition with Design A, and sequencing

**C = A + a ~30-line Tier 0 router + a testing obligation + a benchmarking discipline.** Tier 1/2/3 are things A should contain anyway (they are the dossier's consolidated implications); C makes them explicit routing commitments. There is no architectural conflict: the router sits entirely in front of `fullParse`, and `fullParse` never knows it exists.

Sequencing (recommended):
1. **Phase 1 — A core, correctness-first**: block+flow recursive descent, scalars, core typing, anchors/aliases, single-doc; yaml-test-suite harness + differential oracle in CI from day one; register in `bench/candidates.ts` group `ours`; `pnpm bench:self` per commit (CLAUDE.md cadence).
2. **Phase 2 — add block-style fixtures, then tune Tiers 1/2** profile-driven against *both* styles (datasets change → one `bench:competition` re-run). Tuning before block fixtures exist would over-fit to flow JSON.
3. **Phase 3 — Tier 0 router, last.** Reasons to sequence it last: (a) without `fullParse` the fallback is vaporware; (b) added early, it masks full-parser regressions on the fixture suite; (c) it needs the `duplicateKeys` option surface to exist.

**Testing strategy** (correctness is in scope — the yaml-test-suite awaits): yaml-test-suite runner from Phase 1; **differential fuzzing with JSON.parse as oracle** (generate random JSON, assert `fullParse(doc)` ≡ `JSON.parse(doc)` with delegation disabled — Tier 0's soundness argument makes this a total oracle over the JSON subset); differential spot-checks vs js-yaml on block corpora with a documented-divergence allowlist (`-0`, `1e999`, dup-keys, timestamps).

## 8. Performance model (quantified — see expected_performance for the derivation chain)

| scenario | vs js-yaml@4.3 | vs JSON.parse | basis |
|---|---|---|---|
| current JSON fixtures, router **on** | **5.7–7.1× faster** | **≈1.00×** (−0.2 % floor at 1 KB) | delegation ≡ JSON.parse + 11.7 ns; js-yaml is 5.71–7.14× slower than JSON.parse on these fixtures (dossier §micro (a)) |
| current JSON fixtures, router **off** (full parser) | **3–4× faster** | **0.45–0.65×** | minijson calibration 57–76 % of native, minus 10–20 % YAML-generality tax |
| block-style variant (hypothetical) | **2.5–4× faster** | 0.3–0.5× of JSON.parse-on-equivalent-JSON | js-yaml does 18.1 MB/s on block (bench5); our flow→block slowdown bounded by indent/plain-scalar costs, ≤1.5× vs js-yaml's own 1.6× |
| peak RSS, 10 MB × 25 iters | router-on: ≈ JSON's 282 MB vs js-yaml 495 MB; router-off: est. 300–380 MB | — | README.md:38-42 table; full parser allocates ≈ output + slices, no per-node snapshots/state objects |

Failure condition worth naming: if the full parser lands at only ~1.5× js-yaml on block style, C's router cannot rescue it — the block table is the honest scoreboard.

## 9. File-level plan

- `src/parse.ts` — public API + Tier 0 router (§2.1).
- `src/full/` — Design A parser: `scan-block.ts`, `scan-flow.ts` (Tier 1), `scalars.ts` (Tier 2), `tables.ts` (char-class Uint8Arrays), `errors.ts` (lazy position).
- `bench/candidates.ts` — add `{ name: "lightning-yaml", group: "ours", ... }` plus a delegation-off variant row (env-gated) for the two-row README story.
- `bench/fixtures/datasets.ts` — add `*-block` datasets via `yaml.stringify` of the same seeded values (README.md:143-146 already anticipates this).
- `test/` — yaml-test-suite runner, JSON differential fuzzer, js-yaml divergence allowlist tests.

## EXPECTED PERFORMANCE
**Current JSON fixtures (flow-style), router ON — the delegated path:** cost = first-char sniff (measured 11.7 ns) + native JSON.parse. On the 952 B fixture JSON.parse has a ~5.3 µs floor (dossier micro-bench (a)), so overhead is ~0.2 %; at 10 MB it is unmeasurable. Therefore ours ≡ JSON.parse: ~180 MB/s flat / 134-140 MB/s xlarge-nested on this machine, i.e. **5.7-7.1× faster than js-yaml@4.3.0** (js-yaml measured 5.71-7.14× slower than JSON.parse across all six fixtures, 23-27 MB/s) and **~1.00× JSON.parse** by construction. Peak RSS on the 10 MB × 25-iter memory harness = the JSON row: **282 MB vs js-yaml's 495 MB** (README.md:38-42).

**Current fixtures, router OFF — the honest full-parser number:** the 166-line minijson calibrator measured 98-104 MB/s = 57-76 % of native JSON.parse on these exact fixtures (deepStrictEqual-verified). A YAML-superset flow scanner adds switch arms for `'`/plain/`&*!`/`? `/comments and an anchor check that is pay-on-first-use — estimated 10-20 % tax on top of minijson (arms not taken are near-free; the tax is mostly plain-scalar-possible key scanning where JSON knows keys are quoted). Chain: 0.57-0.76 × (0.80-0.90) ⇒ **0.45-0.65× JSON.parse ≈ 80-115 MB/s ⇒ 3-4.3× js-yaml** (js-yaml 23-27 MB/s). The dossier independently confirms the same parser class beating js-yaml 3.9× on identical bytes (12.2 ms vs 47.5 ms on large-records).

**Hypothetical block-style variant (yaml.stringify of same data):** JSON.parse cannot participate; the reference is JSON.parse on the equivalent JSON bytes (~135-180 MB/s). js-yaml measured 18.1 MB/s on block vs 29.4 flow (bench5) — a 1.6× per-byte penalty for the incumbent. Our block mode pays: per-line indent counting (indexOf('\n') hops at ~5 GB/s + short space runs), plain-scalar end detection (`: `/` #` lookahead folded into a Uint8Array(256) stop table — raw charCodeAt ceiling 1255 MB/s means scanning is ~8 % of budget; dossier micro (b),(4)), and inline first-char typing — while *not* paying js-yaml's per-node double-composeNode implicit-key frames, 6-resolver chain, snapshot allocations, or segment re-validation. Expected block penalty vs our own flow speed ≤1.5× ⇒ **~55-80 MB/s ⇒ 2.5-4× js-yaml's 18.1 MB/s, and 0.3-0.5× JSON.parse-on-equivalent-bytes**. Honesty note: "approaching JSON.parse" is only literally true on flow/JSON input (where it is achieved by delegation, at 1.00×) and on string-heavy documents (where pure JS measured *above* native, 1393 vs 1057 MB/s); on block YAML the defensible claim is 0.3-0.5× JSON.parse and a clear multiple over js-yaml.

**Adversarial worst case (router on):** a 10 MB valid-JSON prefix ending in a YAML-only token costs one wasted native scan — measured 92.6 ms — before the full parse, ≈1.5-1.7× total vs router-off. Small block docs never pay the 4-6 µs failed-JSON.parse SyntaxError tax because the 11.7 ns sniff rejects them.

**Memory (full parser):** allocations ≈ output values + short-lived slices + interned keys; no per-node objects (js-yaml 4.3 allocates a 9-field snapshot per node, per-mapping Object.create(null), per-pair delete). Expect 10 MB × 25-iter peak RSS between JSON's 282 MB and ~380 MB, clearly under js-yaml's 495 MB; delegated path exactly matches JSON's 282 MB.

## KEY ASSUMPTIONS
- The benchmark evolves as the README itself proposes (README.md:141-146): block-style fixture variants get added and both styles are reported, with a delegation-off row for ours — without this, C's headline numbers on the current flow-JSON fixtures are ethically indefensible as evidence of YAML-parsing speed.
- Last-wins duplicate-key default is acceptable to users and the yaml-test-suite (inference: rapidyaml passes 100% of the suite while permitting duplicates; js-yaml itself offers json:true last-wins) — if the market demands js-yaml's throw-by-default, Tier 0 is disabled by default and the flow-fixture story degrades to the 0.45-0.65× full-parser number.
- The minijson calibration transfers: a YAML-superset flow scanner costs no more than ~20% over the measured 57-76%-of-native JSON scanner, and block-mode costs no more than ~1.5× our flow mode (vs js-yaml's own measured 1.6× block penalty). If block YAML's indentation/plain-scalar handling costs 2-3× instead, the block-variant target drops toward ~2× js-yaml.
- V8 behaviors persist on Node >=20: SlicedString O(1) slice at >=13 chars, indexOf at memchr speed, flat-string charCodeAt fast path, JSON.parse's hidden-class feedback and iterative deep-nesting fallback, and a ~µs-scale SyntaxError construction cost (the sniff's justification).
- There is no valid-JSON input on which JSON.parse succeeds but YAML 1.2 core semantics require a different *value* beyond the enumerated set (duplicate keys by policy; -0/1e999 where we side with JSON.parse against js-yaml's measured quirks) — the delegation soundness proof and the differential-fuzz oracle both rest on this enumeration being complete.

## RISKS
- Optics/ethics: even with two-row reporting, 'approaches JSON.parse' headlines can be dismissed as 'it IS JSON.parse' — the claim must always be scoped to input style; the block-style table is the real scoreboard and must be committed alongside the flow one.
- Drop-in incompatibility with js-yaml defaults: last-wins duplicate keys (js-yaml throws), no timestamp->Date, no sexagesimal/0b leftovers, -0 and 1e999 corrections — each is spec-defensible but any could surprise a migrating user; needs a prominent compatibility table in the README.
- Adversarial near-JSON documents (valid-JSON prefix + trailing YAML construct) pay a full wasted native scan (measured 92.6 ms at 10 MB, ~1.5-1.7x total) and no cheap pre-verification exists; a hostile benchmark could weaponize this against us.
- Full-parser block-mode performance is the load-bearing unknown: if indentation tracking + plain-scalar termination push us to only ~1.5-2x js-yaml on block style, the design's honest win condition fails even while the fixture table looks spectacular.
- Every fast-path arm is a divergence surface against the yaml-test-suite (Tier 1 flow arms, Tier 2 scalar typing, escape handling); mitigated by suite-in-CI from Phase 1 and the JSON differential oracle, but conformance debt compounds if fast paths land before the test harness.
- The target moved: js-yaml 5.x (June 2026 TypeScript rewrite) is out while the repo pins ^4.1.0 (installs 4.3.0) — all measured ratios are against 4.3.0; a dependency bump could change both the speed bar and the semantics we mirror (per CLAUDE.md, that bump forces a bench:competition re-run).
- V8 internals drift (SlicedString threshold, SyntaxError cost, JSON.parse feedback machinery) would silently shift the measured constants underpinning the router thresholds; ratios need re-validation on each Node major.
- Peak-RSS estimate for the full parser (300-380 MB) is modeled, not measured — SlicedString retention pinning the 10 MB source and key-intern cache growth on hostile inputs (many unique keys) could push it higher; needs early measurement via the repo's own memory harness.