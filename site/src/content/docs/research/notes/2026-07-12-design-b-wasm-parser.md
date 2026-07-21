---
title: "lightning-yaml Design Brief B: WASM-wrapped rapidyaml with in-WASM YAML→JSON transcode + native JSON.parse"
description: "A WASM design wrapping rapidyaml with an in-WASM YAML-to-JSON transcode: it beats js-yaml but can't approach JSON.parse, and the route was rejected"
---
> Produced by a multi-agent research session (Claude Code). All local numbers were measured on the session container — Node v22.22.2 / V8 12.4, 4-vCPU Xeon 2.80 GHz, 16 GB RAM; absolute MB/s are machine-specific, ratios are the durable signal. Referenced `scratchpad/*.mjs` scripts were session throwaways and are not committed.

## Design Brief B — WASM-wrapped native YAML parser

**Verdict up front (honest):** the strongest WASM design is *rapidyaml compiled with Emscripten, transcoding YAML→JSON entirely inside linear memory, then materializing JS values with one `TextDecoder.decode` + one native `JSON.parse`*. Dossier math says it beats js-yaml@4.3 by ~1.4–2.1× across 1 KB–10 MB and lands at ~2.8–4.5× slower than `JSON.parse` — it structurally **cannot approach JSON.parse**, because `JSON.parse` is a mandatory component of its own fast path (WASM ROUTE §5). It can beat js-yaml on peak RSS, but only with deliberate instance-lifecycle management, and not "clearly" (est. 330–430 MB vs 495 MB vs JSON's 282 MB on the 25×10 MB harness). This is the honest ceiling of the WASM route; the dossier's strategic read (pure JS reaches the same ~1.5–2× win without the packaging/memory/conformance taxes) stands, and this document does not hide it.

---

## 1. Library choice: rapidyaml (ryml), pinned tag, vendored; saphyr-parser (Rust) as the named fallback

**Chosen: rapidyaml (biojppm/rapidyaml), MIT, C++.**

Justification from the dossier (WASM ROUTE §1):

- **Speed with receipts.** ryml self-publishes ~150 MB/s YAML parse on Linux (131.6–176.4 MB/s), ~388–457 MB/s JSON parse, "2–3× faster than libyaml", "10–70× faster than yaml-cpp" (https://rapidyaml.readthedocs.io/v0.7.2/sphinx_is_it_rapid.html). No other candidate publishes numbers at all.
- **Conformance with receipts.** Passes 100.00% of the YAML test suite, with documented deviations (scalar-only keys, tabs after `:`/`-` rejected by default, `%YAML` directives ignored, duplicate keys permitted). Since v1 targets "what js-yaml.load accepts" and will eventually face yaml-test-suite, a 100%-passing base is the right starting point; the deviations are enumerated in §4 as our conformance debt.
- **WASM path exists.** README states it is CI-tested on emscripten; the JS/WASM port is explicitly WIP and there is **no npm package** (registry 404 verified in the dossier) — so we are productizing an existing compile target, not pioneering one, and the npm niche is empty (the only prior art, `yaml-wasm`, wrapped dead yaml-rust 0.4 and was archived Mar 2022 without benchmarks).
- **License/maintenance:** MIT; actively developed; multi-arch CI (x64/arm/ppc64le/s390x/emscripten).

**Rejected alternatives, with dossier evidence:**

| option | why not |
|---|---|
| libfyaml | Fastest-conformant-C *claim* but zero published numbers, release line stuck at 1.0-alpha; third parties measure fkYAML ~70% faster on some workloads (https://github.com/pantoniou/libfyaml, https://github.com/fktn-k/fkYAML). Autotools C build is also the worst emscripten ergonomics of the set. |
| libyaml | Maintained but slow: "heavy use of allocations and string duplications" (rapidyaml alternative-libraries doc); ryml claims 2–3× over it. After a 1.45–2.5× wasm derate (USENIX ATC'19 mean 1.55×; nickb.dev 1.75–2.5×), libyaml-in-wasm plausibly *ties or loses to js-yaml* (24–29 MB/s here). Disqualifying. |
| serde-yaml / unsafe-libyaml | Archived by dtolnay Mar 25 2024; dead. |
| serde_yml | AI-slop fork, RUSTSEC-2025-0068 unsound; avoid (Debian bug msg2018921). |
| yaml-rust2 | Alive but maintenance-mode and by its own release post slower than libfyaml — likely sub-js-yaml after wasm derate. |
| **saphyr-parser (fallback)** | The active Rust successor, event-based API — the **memory-sane** architecture (streaming transcode needs only input+output ≈ 25–35 MB linear memory vs ryml's ~80–110 MB tree, WASM ROUTE §4). Named fallback if ryml's memory profile fails the harness (§5) — but it carries an unquantified speed risk (no published throughput; if it lands near yaml-rust2's class it may not clearly beat js-yaml after derate). |

**Maintenance risk, stated plainly:** we take a C++ dependency (vendored as a git submodule at a pinned tag), a pinned emscripten toolchain, and a WIP upstream wasm port. And the target has moved: js-yaml 5.2.1 (full TS rewrite, June 2026) is now current while this repo pins ^4.1.0 (installed 4.3.0) — a win over js-yaml@4 may not survive re-benchmarking against 5.x (WASM ROUTE §1 note).

## 2. Boundary strategy — the crux

Three options, decided by measured numbers from this machine (Node 22.22.2):

### 2a. Per-node JS imports (wasm calls back into JS to build objects) — REJECTED
Raw wasm→JS call overhead is fine (~15.5 ns, callcost.mjs), but the work each callback must do is not: a callback allocating `{v:x}` costs ~126 ns, and `TextDecoder.decode` of an 8–64 B subarray costs ~130–141 ns. The fixtures carry ~68 K nodes/MB (xlarge: 729,516 nodes, 837,623 strings — nodecount.mjs). For 10 MB: ~730 K structure callbacks × 126 ns ≈ 92 ms + ~838 K string decodes × 130 ns ≈ 109 ms ≈ **200 ms of pure boundary/materialization before any parsing** — vs `JSON.parse` doing the *entire job* in 79.8 ms. This path roughly ties js-yaml and is exactly why serde-wasm-bindgen-style building loses (wasm-bindgen#2539; WASM ROUTE §2).

### 2b. Compact binary tape decoded by a JS driver — REJECTED
A tape avoids JSON *syntax* costs but keeps the killer: every string still crosses the boundary via `TextDecoder.decode(subarray)` at ~130 ns fixed overhead (or `fromCharCode` loops at 65–115 MB/s), so 838 K strings ≈ 109 ms, *plus* JS-side object construction at hand-parser rates. That replaces the 79.8 ms native `JSON.parse` (which materializes strings and objects at engine speed, with hidden-class feedback — V8 §T6) with a strictly slower JS reimplementation. Worse than 2c on every fixture, and it's the most code.

### 2c. YAML→JSON transcode inside wasm + native JSON.parse — CHOSEN
The proven pattern: swc and oxc ship ASTs to JS as JSON strings + `JSON.parse` because it measured faster than per-field FFI object building (https://github.com/oxc-project/oxc/issues/2409; swc#2175). Measured locally: `TextDecoder` on MB buffers ~2 GB/s, and `decode + JSON.parse` ≈ `JSON.parse` + ~10% (78.3 vs 70.8 ms on xlarge; boundary-bench.mjs). Input side is free: `TextEncoder.encodeInto` straight into the wasm heap runs 9.6–21.7 GB/s.

**Pipeline:** `encodeInto(src, heapView)` → `wasm: ryml parse (in-situ, arena) → walk tree, emit JSON bytes into an output arena` → `TextDecoder.decode(outView)` → `JSON.parse(jsonStr)` (or `JSON.parse(str, reviver)` only when the transcoder flagged specials — §4).

**Transcoder rules that keep it fast and correct:**
- **Scalar-verbatim numbers:** when a plain scalar is core-schema numeric and already JSON-legal (`1.5`, `-2e3`, `123`), copy its bytes verbatim — zero conversion in wasm, V8's own StringToDouble does the work inside `JSON.parse`. Only non-JSON numeric forms (`0x1F`, `0o17`, `+1`, leading-dot floats) are normalized in C++ (integer forms via u64 accumulate + itoa; no dtoa needed anywhere).
- **Strings:** escape-free fast path = memcpy between quotes; else unescape YAML escapes (`\xXX`, `\UXXXXXXXX`, `\e`, …) and re-escape as JSON. Block scalars are folded/chomped in wasm and emitted as JSON strings.
- **Keys:** always emitted as JSON strings (JS object keys are strings anyway; js-yaml does `String(keyNode)` — loader.js:421). `__proto__` keys are safe: `JSON.parse` creates own properties.
- **null/bool normalization:** `~`, `null`/`Null`/`NULL`, empty, `true`/`True`/`TRUE` etc. → `null`/`true`/`false`.
- **Anchors/aliases:** expanded during emit (JSON has no references), guarded by an output-budget (emitted bytes ≤ configurable multiple of input, default e.g. 64×) to stop billion-laughs amplification — mirrors js-yaml 4.3's own DoS guards. **Documented divergence:** js-yaml's aliases are *shared references* in the output (`anchorMap`, loader.js:1382); ours are structural copies. See §8.

### End-to-end math (measured components; wasm parse = ryml's 150 MB/s native derated 1.45–2.5× → 60–103 MB/s; JSON emit ≈ 30–60 ms/10 MB derated; local baselines from a-parsers.mjs)

| doc | encodeInto | wasm parse | JSON emit | decode | JSON.parse | **total (est)** | js-yaml (measured) | **vs js-yaml** | vs JSON.parse |
|---|---|---|---|---|---|---|---|---|---|
| 952 B (warm) | ~0.3–1 µs | 9–16 µs | 3–6 µs | ~0.6–1 µs | 5.3 µs | **~18–30 µs** | 35.7 µs | 1.2–2.0× faster | 3.4–5.7× slower |
| 106 KB | ~10 µs | 1.03–1.77 ms | 0.32–0.64 ms | ~0.05 ms | 0.581 ms | **~2.0–3.1 ms** | 4.02 ms | 1.3–2.0× faster | 3.4–5.3× slower |
| 10.73 MB | 1–3 ms | 104–179 ms | 30–60 ms | ~5 ms | 79.8 ms | **~220–330 ms** | 455.4 ms | 1.4–2.1× faster | 2.8–4.1× slower |

Cold first call adds one-time base64 decode (<1 ms for a ≤1 MB module; 5.5 ms measured for 14 MB) + sync compile (~0.7 ms/MB measured: 10.49 MB in 7.6 ms — synccompile.mjs).

## 3. Packaging & API

- **Artifact:** the `.wasm` is **base64-embedded in a generated ES module** (`src/ryml-wasm.generated.ts` exporting a string) — the shiki pattern (https://nuxt.com/blog/shiki-v1), avoiding the async-init/URL bootstrap that killed source-map 0.7 adoption. Cost: +33% package bytes, <1 ms decode.
- **Size budget:** target ≤ 400 KB wasm (-Oz, `-fno-exceptions -fno-rtti`, emmalloc, `STANDALONE`-ish minimal JS glue), i.e. ≤ ~540 KB base64. Hard cap 1 MB wasm; if ryml + transcoder exceed it, that is a red flag on the whole route (js-yaml is ~50 KB). This budget is an *estimate*, not a measurement — first build task is to validate it.
- **API (Node, primary):** `parse(text: string): unknown` — fully **sync**, js-yaml parity. Lazy: first call decodes base64 + `new WebAssembly.Module(bytes)` + instantiate (Node has no sync-compile size limit — verified 10.49 MB in 7.6 ms). Matches the harness `Candidate.parse` signature exactly (bench/candidates.ts:24-25).
- **Browser (nice-to-have):** same sync API works on Chrome ≥ M114 (4 KB main-thread sync-compile cap lifted; blink-dev thread), Firefox and Safari (never capped), and all workers. Export an optional `async init()` for pre-warming and legacy Chrome; document that first sync call on old Chrome main thread throws.
- **TypeScript:** wrapper is ~200 lines of TS; the generated base64 module is checked in, so `pnpm install` needs **no native toolchain** and `tsc --noEmit` covers everything.

## 4. Semantics: closing the JSON-representability gap

JSON cannot carry everything js-yaml.load's core-schema output can (WASM ROUTE §2b caveats). Design: **pay-on-use sentinels + reviver.**

- During emit, unrepresentable values (`.inf` → Infinity, `.nan`, `-.inf`) are emitted as sentinel strings (`"inf"` etc.) and a `hasSpecials` flag is set in the wasm return struct. JS side: `hasSpecials ? JSON.parse(s, reviver) : JSON.parse(s)`. The reviver (which meaningfully slows `JSON.parse`) is only paid by documents that actually contain specials — analogous to js-yaml's pay-on-throw error design (loader.js:186-198).
- v1 targets **core schema** (scope statement): no timestamps→Date. (If js-yaml-default-schema compat is later required, the same sentinel/reviver mechanism carries `Date`.)
- Duplicate keys: `JSON.parse` is last-wins; js-yaml throws by default. The transcoder detects duplicates per mapping in C++ (ryml permits them) and errors, matching js-yaml.
- **Inherited ryml deviations = our conformance debt:** scalar-only keys (js-yaml stringifies collection keys to `"[object Object]"` — rare; v1 errors clearly and documents it), tabs after `:`/`-` rejected by default (must check upstream flags or patch before yaml-test-suite), `%YAML` directives ignored. These are exactly where yaml-test-suite will bite; budget for it.
- Multi-doc: v1 errors on `---` beyond the first document, like `js-yaml.load` (vs `loadAll`).

## 5. Memory design — linear memory vs the peak-RSS harness

Facts (WASM ROUTE §4, all verified locally): wasm memory grows in 64 KiB pages, **can never shrink** (no shipped memory-control proposal); `Memory.grow(100 MB)` + touch = permanent +99 MB RSS; emscripten overshoots growth +20% geometric (cap 96 MB); everything counts fully in `process.resourceUsage().maxRSS` — the exact metric of `bench/memory` (README.md:34-36).

Arithmetic for the 10 MB fixture through ryml: NodeData ≈ 68–88 B/node on wasm32 × ~730 K nodes ≈ 50–64 MB tree, + 10.7 MB input copy + ≥10.7 MB emitted JSON + growth overshoot ⇒ **~80–110 MB linear memory, permanent per instance**. JS side adds the source string, the ~10.7 MB decoded JSON string per iteration (garbage), and the result objects (≈ JSON.parse's profile).

**Mitigations (designed in, not optional):**
1. **Two-tier instance lifecycle.** One warm, persistent instance sized for small/medium docs (INITIAL_MEMORY 16 MB, handles inputs ≤ ~2 MB). Inputs above the threshold run on a **throwaway instance** whose `WebAssembly.Memory` becomes garbage immediately after the parse — V8's external-memory accounting reclaims it, so the process floor is not set by the largest document ever seen. Cost: ~0.7 ms/MB re-instantiate on big docs only (noise vs a 220–330 ms parse); the compiled `WebAssembly.Module` is cached and reused.
2. **Arena discipline in wasm:** single reset-able bump arenas for tree + output; no per-node malloc (avoids emmalloc fragmentation-driven grows).
3. **Exact-ish output sizing:** pre-size the JSON output arena to `inputLen × 1.2 + 64 KB` and grow geometrically only on demand.

**Peak-RSS forecast for the 25×10 MB harness:** persistent-instance worst case ≈ 380–430 MB (dossier estimate: JSON.parse-like churn ~282 MB + ~100 MB floor + per-iter 21 MB string garbage); with the throwaway policy, bounded by ~1–2 live Memories ⇒ **est. 330–400 MB**. That **beats js-yaml's 495 MB but is far above JSON's 282 MB** — a "beats", not a "clearly beats". If the harness disagrees (V8 collecting dropped Memories too lazily), the escape hatch is the saphyr streaming transcoder (25–35 MB linear ⇒ ~300–330 MB, near-JSON profile) at a speed risk.

String-copy accounting per parse (unavoidable in this route): UTF-16 source → UTF-8 into wasm (1 copy, ~free via encodeInto), JSON bytes in wasm (1 buffer), decoded JSON JS string (1 copy, ~5 ms/10 MB), then `JSON.parse` output. Four transient representations — that is the route's memory identity, and why it can never match JSON.parse's RSS.

## 6. Toolchain & repo integration

- **Build:** `native/` dir with ryml as a git submodule at a pinned tag + `transcode.cpp` (~600–1000 lines: tree walk, scalar typing per core schema, JSON escaper, sentinel logic, dup-key check, alias budget). CMake + emscripten; built inside the digest-pinned `emscripten/emsdk` Docker image so any machine (and CI) produces byte-identical output.
- **Committed artifact:** yes — commit `src/ryml-wasm.generated.ts` (base64) so `pnpm install && pnpm typecheck && pnpm bench:self` work with zero native toolchain, preserving the repo's current friction level. A CI job rebuilds in the pinned image and **fails if sha256 differs** from the committed artifact (reproducibility gate). Rebuilds happen only when `native/` changes.
- **Harness registration:** add to `bench/candidates.ts` with `group: "ours"` per CLAUDE.md; note the `Candidate` interface requires `stringify` (bench/candidates.ts:27) — v1 is parse-only, so either make `stringify` optional in the interface (and teach `stringify.bench.ts` to skip) or register a throwing stub; the former is the honest harness change.
- **Cadence:** `pnpm bench:self` before every commit (CLAUDE.md rule); `bench:competition` untouched. `pnpm typecheck` covers the wrapper; the wasm build is a separate `pnpm build:wasm` script that requires Docker.
- **Tests:** yaml-test-suite runner (event-less mode: compare parsed JS values) + differential fuzz vs `js-yaml.load` on generated docs; both run in CI on the committed artifact.

## 7. Failure modes — where this LOSES

1. **To JSON.parse: always, by 2.8–5.7×.** Structural — `JSON.parse` (79.8 ms on xlarge) is a *component* of our pipeline, so "approach JSON.parse" is off the table for this route. The pure-JS ceiling evidence (minijson at 57–76% of native; handrolled beating js-yaml 3.9×) shows a JS parser has a *higher* ceiling than this design on string-heavy input.
2. **Small docs / cold start:** first call pays base64 decode + compile (~1–4 ms for a ≤1 MB module) — any CLI that parses one small YAML file and exits is slower than js-yaml on that first parse. Warm, the 1 KB win compresses to 1.2–2.0× and per-call fixed costs (encode setup, decode call, arena reset) are the dominant risk to the low end of that range.
3. **Anchor/alias-heavy docs:** expansion during transcode multiplies output bytes; js-yaml shares references at O(1) (anchorMap). A Stripe-style yarn.lock could see us *lose* to js-yaml's 50 ms while emitting tens of MB of JSON — and the output semantics differ (copies, not shared identities). Must be documented; the budget guard turns bombs into errors, not hangs.
4. **Peak RSS "beats but not clearly":** 330–430 MB vs js-yaml 495 MB is a thin margin against the project's stated goal of clearly beating js-yaml on memory; a wasm allocator overshoot or lazy Memory collection erases it.
5. **Conformance debt vs "what js-yaml.load accepts":** ryml's tab handling, scalar-only keys, and permitted dup-keys need wrapper-level fixes or upstream flags before yaml-test-suite parity.
6. **Maintenance burden:** C++ submodule + emsdk pin + reproducibility CI + a WIP upstream wasm port, vs a competitor (js-yaml 5, June 2026 TS rewrite) that just modernized — the 1.4–2.1× measured margin over 4.3 may shrink against 5.x.
7. **Real-world wasm derate is confirmed, not speculative:** USENIX ATC'19 (mean 1.55× slower than native), nickb.dev (native addons 1.75–2.5× faster than same-code wasm), esbuild ("order of magnitude" for Go). Our math already prices this in at 1.45–2.5×; if ryml's wasm derate lands at the bad end *and* emit is slow, the 10 MB total drifts toward ~330 ms — still a win over 455 ms, but the margin is 1.4×, not 2×.

## 8. Quantified expectations (to publish as targets in README "Our implementation")

- **Speed vs js-yaml@4.3 (this machine):** 1.4–2.1× faster at 10 MB (est. 220–330 ms vs 455.4 ms), 1.3–2.0× at 100 KB (est. 2.0–3.1 ms vs 4.02 ms), 1.2–2.0× at 1 KB warm (est. 18–30 µs vs 35.7 µs). Effective throughput ≈ 33–49 MB/s vs js-yaml's 23–27 MB/s.
- **Speed vs JSON.parse:** 2.8–4.1× slower at 10 MB, 3.4–5.3× at 100 KB, 3.4–5.7× at 1 KB. Floor = JSON.parse + transcode; parity impossible by construction.
- **Peak RSS (25×10 MB harness):** est. 330–430 MB vs js-yaml 495 MB vs JSON 282 MB — beats js-yaml, nowhere near JSON; the never-shrink linear memory is managed, not eliminated, by the throwaway-instance policy.
- **Go/no-go gates:** (G1) wasm module ≤ 1 MB; (G2) 10 MB fixture ≤ 350 ms end-to-end; (G3) harness peak RSS ≤ 450 MB; (G4) yaml-test-suite pass rate ≥ js-yaml's on the value-comparison subset. Failing G2 or G3 triggers the saphyr-parser streaming fallback evaluation; failing that kills the route in favor of pure JS.

## 9. Build order

1. Skeleton: emsdk Docker build of ryml `parse_in_arena` + trivial emitter; measure module size (G1) and raw wasm parse MB/s on the fixtures — this single measurement collapses most of the 60–103 MB/s uncertainty.
2. Full transcoder (scalar typing, escapes, sentinels, dup-key, alias budget) + TS wrapper with two-tier instances.
3. Register in `bench/candidates.ts` (`group: "ours"`), adjust `stringify` optionality, run `pnpm bench:self`, commit README block per CLAUDE.md.
4. yaml-test-suite + differential fuzz vs js-yaml; fix wrapper-level deviations.
5. Memory-harness validation of the instance policy; if G3 fails, prototype saphyr streaming transcoder.


## EXPECTED PERFORMANCE
Vs js-yaml@4.3.0 (measured on this machine at 23–27 MB/s: 35.7 µs / 4.016 ms / 455.4 ms for the 952 B / 106 KB / 10.73 MB fixtures — scratchpad a-parsers.mjs): expected 1.4–2.1× faster at 10 MB, 1.3–2.0× at 100 KB, 1.2–2.0× at 1 KB warm. Reasoning chain: total time = encodeInto (measured 9.6–21.7 GB/s, ~1–3 ms at 10 MB) + wasm YAML parse (ryml's published ~150 MB/s native derated by the measured real-world wasm penalty of 1.45–2.5× per USENIX ATC'19 / nickb.dev ⇒ 60–103 MB/s ⇒ 104–179 ms at 10 MB) + in-wasm JSON emit (~30–60 ms derated from ryml's RapidJSON-ballpark emit rates) + TextDecoder (measured ~2 GB/s ⇒ ~5 ms) + native JSON.parse (measured 79.8 ms on xlarge; decode+parse measured at only +10% over parse alone) ⇒ ~220–330 ms vs js-yaml's 455 ms. Vs JSON.parse (measured 180 MB/s flat / 134.5 MB/s xlarge): expected 2.8–4.1× slower at 10 MB and 3.4–5.7× slower at 1 KB–100 KB, with parity structurally impossible because JSON.parse is itself a component of the pipeline — the transcode route's floor is JSON.parse + wasm parse + emit + decode. Peak RSS on the repo's 25×10 MB harness: estimated 330–430 MB (JSON.parse-like churn ~282 MB + ~80–110 MB never-shrinking linear memory managed via throwaway instances + ~21 MB/iter decoded-JSON garbage) vs measured js-yaml 495 MB and JSON 282 MB — beats js-yaml on memory, but thinly, and never approaches JSON. The rejected per-node-callback boundary would have added ~200 ms/10 MB of measured boundary+materialization cost (730 K callbacks × 126 ns + 838 K string decodes × 130 ns) and roughly tied js-yaml, which is why transcode+JSON.parse is the only viable output path.

## KEY ASSUMPTIONS
- rapidyaml's published ~150 MB/s native YAML parse rate survives Emscripten compilation within the 1.45-2.5x derate band measured for other wasm workloads (USENIX ATC'19, nickb.dev); if wasm ryml lands below ~45 MB/s on the fixtures, the margin over js-yaml (24-29 MB/s) collapses.
- The in-wasm JSON emitter runs at >=150 MB/s derated (~30-60 ms/10 MB) using scalar-verbatim byte copies; if escaping/typing pushes emit toward parse-cost levels, the 10 MB total drifts past 350 ms and the win thins to <1.3x.
- V8 promptly collects dropped WebAssembly.Memory objects under the throwaway-instance policy, keeping <=2 live ~100 MB linear memories during the 25-iteration harness; lazy collection would push peak RSS above js-yaml's 495 MB and fail the memory goal.
- ryml + transcoder compile to <=~1 MB of wasm with -Oz/no-exceptions and its WIP emscripten port needs no deep upstream fixes; a multi-MB module or broken port sinks packaging (base64-inline) and cold-start economics.
- The benchmark target remains js-yaml@4.x semantics/performance (repo pins ^4.1.0, installed 4.3.0); js-yaml 5.2.1's June 2026 TS rewrite has not materially closed the 5.7-7.1x gap to JSON.parse that the 1.4-2.1x projected win is built on.

## RISKS
- Structural ceiling: can never approach JSON.parse (2.8-5.7x slower by construction, since JSON.parse is a pipeline component) — while the dossier's pure-JS evidence (minijson at 57-76% of native, 3.9x faster than js-yaml) shows a plain-JS parser has a higher ceiling with none of this route's taxes; the wasm route is the strategically weaker option even when it works.
- Peak-RSS margin is thin (est. 330-430 MB vs js-yaml 495 MB on the 25x10 MB harness): wasm linear memory never shrinks, emscripten overshoots growth by 20%, and the mitigation (throwaway instances for large docs) depends on GC timing we do not control.
- Anchor/alias-heavy documents: transcode must expand aliases (JSON has no references), so output bytes multiply — pathological-but-real files (Stripe yarn.lock class, where js-yaml takes 50 ms) can make us slower than js-yaml AND change semantics (structural copies instead of js-yaml's shared references); budget guard converts bombs to errors, not wins.
- Conformance debt vs 'what js-yaml.load accepts' and yaml-test-suite: inherited ryml deviations (tabs after ':'/'-' rejected, scalar-only keys, %YAML ignored, dup keys permitted) plus JSON-representability gaps (.inf/.nan via sentinel+reviver, no Date, dup-key policy) each need wrapper or upstream work.
- Maintenance/toolchain burden: C++ submodule + digest-pinned emsdk Docker build + artifact-reproducibility CI + dependence on ryml's explicitly WIP emscripten port with zero npm precedent (the only prior wasm-YAML attempt died unbenchmarked in 2022).
- Small-doc/cold-start regression: first call pays base64 decode + module compile (~1-4 ms), losing to js-yaml for parse-one-small-file-and-exit workloads; warm 1 KB win may compress toward 1.2x as per-call fixed costs (encode setup, TextDecoder call, arena reset) bite.
- Competitive drift: js-yaml 5.x (June 2026 rewrite) has not been benchmarked here; a modernized competitor could shrink the projected 1.4-2.1x margin before v1 ships.
- Browser story is weaker than js-yaml's: 300 KB-1 MB inlined package vs ~50 KB, and sync API requires Chrome >=M114 (older Chrome main threads need the async init() escape hatch).