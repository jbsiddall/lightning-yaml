> Part of the [2026-07-12 implementation-strategy research dossier](2026-07-12-research-dossier-overview.md).
> Produced by a multi-agent research session (Claude Code). All local numbers were measured on the session container — Node v22.22.2 / V8 12.4, 4-vCPU Xeon 2.80 GHz, 16 GB RAM; absolute MB/s are machine-specific, ratios are the durable signal. Referenced `scratchpad/*.mjs` scripts were session throwaways and are not committed.

# How fast can pure JS go on V8 — evidence for lightning-yaml's design

Environment for all local experiments: Node v22.22.2 / V8 12.4.254.21-node.39 (bench5 output), this container. Benchmark scripts: `/tmp/claude-0/-home-user-lightning-yaml/5b5afb90-7c63-5a56-af0b-8798d3e9b488/scratchpad/bench{1,2,3,4,5}.mjs`. Absolute MB/s are machine-specific; ratios are the durable signal.

## 1. THE CEILING: pure JS vs native JSON.parse

**Published calibration** — jawj/json-custom-numbers (the fastest known pure-JS JSON parser, https://github.com/jawj/json-custom-numbers): typically **1.5–3x slower than native `JSON.parse`** on Node 20; best cases **faster than native** (long strings ~0.73x, deep nesting 0.96x); worst case short numbers 3.32x. Older pure-JS parsers are far worse: Crockford reference 3.41–14x, json-bigint 3.51–10.29x, lossless-json 2.56–8.33x slower than native.

**Local ceiling experiment** (bench3.mjs — a ~120-line recursive-descent JSON parser: flat-string `charCodeAt`, `indexOf('"')` + memoized next-backslash fast path, `slice` for strings, SMI-arithmetic int fast path):
- mixed 5.9 MB object doc: native 170 MB/s, handrolled **99 MB/s (1.71x slower)**
- 11 MB number array: native 240 MB/s, handrolled 93 MB/s (2.6x — numbers are the weak spot, matches json-custom-numbers)
- 8.6 MB long-string array: native 1057 MB/s, handrolled **1393 MB/s — pure JS BEATS native** (indexOf hop + O(1) SlicedString slice)

**Competition on the same machine, same data** (bench5.mjs): `JSON.parse` 172.8 MB/s; **js-yaml.load on JSON bytes 29.4 MB/s** (5.9x slower than native); js-yaml on block YAML 18.1 MB/s; **eemeli yaml@2.9.0: 1.9 MB/s (JSON bytes) / 1.5 MB/s (block)** — ~15x slower than js-yaml.

**Implication:** "close to JSON.parse" is genuinely achievable: within ~2x on object/number-heavy input, at/above parity on string-heavy input. Beating js-yaml is a low bar — a careful hand parser already ran 3.4x faster than js-yaml *while doing full JSON parsing*. A realistic target: 60–120 MB/s on the repo's JSON fixtures (3–6x js-yaml, 0.4–0.7x JSON.parse).

## 2. String scanning

**String representations (verified in V8 source, https://raw.githubusercontent.com/v8/v8/main/src/objects/string.h):** `SlicedString::kMinLength = 13` and `ConsString::kMinLength = 13` ("Minimum length for a sliced/cons string"); flattening allocates a sequential copy and mutates the ConsString into a degenerate form.

**Representation matters for charCodeAt** (bench2.mjs): scan of 7.6M chars — flat SeqString **513 MB/s**, SlicedString 356 MB/s, ConsString 301 MB/s. V8's inlined charCodeAt fast path only covers flat strings. Input read from `fs.readFileSync` is flat; avoid feeding the parser concat-built strings, or flatten first (e.g. any operation that forces flattening).

**Bytes vs charCodeAt** (bench1.mjs): Uint8Array scan 760 MB/s vs charCodeAt ~513 (flat) — **typed-array loads ~1.5x faster per char**; `TextEncoder.encode` of 8M chars is cheap one-time (1519 MB/s, ~0.7 ms/MB). BUT see materialization below before choosing bytes.

**indexOf is the real weapon** (bench1.mjs): `String.prototype.indexOf('\n')` line-hopping runs at **5.0 GB/s** (V8 runtime memchr/SIMD); `Uint8Array.prototype.indexOf` 1.6 GB/s. Skipping to newline / closing quote / next special char via `indexOf` is 10x any JS char loop. This is exactly why the handrolled parser beat native on strings.

**Substring materialization** (bench2.mjs, 200k substrings): `str.slice` — len 12: ~18 ns/call (copies); **len 13: ~6.4 ns/call and O(1) at any length** (SlicedString cliff exactly at kMinLength=13; len 200 = 29 GB/s equivalent). `TextDecoder.decode(subarray)`: **~140–150 ns/call fixed overhead** (25 MB/s at len 4, still only 1.2 GB/s at len 200). `Buffer.toString('latin1')`: ~95–100 ns/call. `String.fromCharCode` char-by-char build: 65–115 MB/s.

**Implication:** parse **from the JS string**, not from encoded bytes: YAML keys/scalars are mostly short, and slice-from-string is 7–20x cheaper than any bytes→string route. Use `charCodeAt` on a guaranteed-flat string for char dispatch and `indexOf` for delimiter hops. A bytes-scanning phase is only worth it if it avoids materialization entirely (e.g. a structural pre-scan), and byte offsets only equal char offsets for pure-ASCII input. Memory caveat: SlicedString results retain the whole source string; if peak-RSS benchmarking keeps results alive, the ~10 MB source stays alive too (cheap vs js-yaml's overhead, but know it).

## 3. JIT-friendly patterns

**Inline caches** (mrale.ph, https://mrale.ph/blog/2015/01/11/whats-up-with-monomorphism.html): monomorphic > polymorphic (linear search, max **4 entries** for property loads) > megamorphic (global cache). Keep hot call sites and property accesses seeing one shape; if you must handle multiple string/node types, split into per-type functions (bench2 used separate scanA/B/C to keep type feedback clean).

**Inlining budgets** (V8 main `flag-definitions.h`, fetched 2026-07, lines 1589–1615): `max_inlined_bytecode_size` **460**, `_cumulative` 920, `_absolute` 4600; **small functions (≤30 bytecode, ≤75 with HeapNumber in/out) bypass those limits** with a 30000 total budget — V8's own comment: "inlining very small functions is usually very beneficial (removes call overhead, enable better load elimination and escape analysis, removes heap number allocations...)". Critically, `max_optimized_bytecode_size = 60 KB`: **a function whose bytecode exceeds 60KB is never TurboFan-optimized**. Implication: do NOT write one giant parser function — medium-sized monomorphic functions (parseValue/parseBlockMap/parseScalar...) inline fine, keep deopt blast radius small (a deopt discards the whole containing function's optimized code), and tiny helpers are free.

**SMI arithmetic:** keep positions, char codes, indent levels as int32. Parse integers by digit accumulation (`v = v*10 + (c-48)`) — returns SMI, zero allocation; fall back to `+src.slice(...)` only for floats/long ints. The 2.6x number-array gap in bench3 is mostly the `+slice` double path.

**Char-class tables vs branches** (bench1.mjs): `Uint8Array(256)` lookup 306 MB/s vs if-chain 264 vs `switch` 258 — table modestly wins for multi-way classification; `switch` on charCode is not faster than if-chains. Use one `Uint8Array(256)` class table for "is this char special in plain-scalar context" etc.

**Regex vs charCode dispatch** (bench2.mjs): js-yaml's actual float regex (`node_modules/js-yaml/lib/type/float.js:6-15`) over 100k scalars: 3.03 ms vs 1.73 ms for first-char-gated manual scan — 1.75x, and that's ONE regex. js-yaml runs an **implicit-resolver chain per plain scalar** (`lib/loader.js:1566-1573`): null, bool, int, float (`lib/schema/json.js:11-16`) plus timestamp, merge (`lib/schema/default.js:10-13`) — each a call + regex/char-loop re-scanning a scalar the lexer already walked. Implication: resolve scalar type **during** the single scan via first-char dispatch (only `[0-9+-.]` can start numbers; `t/f/n/y/o/T/F/N/Y/O/~` gate bool/null; digits gate timestamps) — this alone is a multi-x win on scalar-heavy YAML.

## 4. Building the result

**Hidden classes** (https://v8.dev/blog/fast-properties): same keys added in same order ⇒ shared HiddenClass via transition tree; different key sets branch the tree; heavy add/delete ⇒ dictionary mode. Local (bench4.mjs, 300k 5-key objects): literal 22.9 ms; `o[k]=v` with constant keys 38.9 ms; with pre-materialized sliced keys 58.9 ms; **keys freshly sliced per object 127.4 ms (3.3x)** — fresh-string key internalization (string-table hashing) dominates, not shape transitions. 8 rotating shapes: 46.3 ms (fine). Unique keys per object: 191.8 ms/100k (unavoidable dictionary-ish cost). Implication: **intern keys yourself** — cache key strings (e.g. Map from slice → first-seen string) so repeated mapping keys across thousands of items reuse the same already-internalized string; shapes then amortize automatically. `Map` objects are ~2x slower to build than plain objects — return plain objects like js-yaml does.

**Arrays** (https://v8.dev/blog/elements-kinds + bench4.mjs): lattice PACKED_SMI→PACKED_DOUBLE→PACKED_ELEMENTS with HOLEY variants; transitions are one-way; a single hole is permanent and forces slower paths. `new Array(n)` starts HOLEY and can never become PACKED — but note: locally, prealloc+sequential-fill was 4x faster to *construct* (29.7 vs 117.7 ms for 5M smis) at the cost of a forever-HOLEY result that's slower for the consumer. Since YAML sequence lengths are unknown mid-parse anyway: **build with `push` (stays PACKED)**; mixed-kind pushes cost roughly the same as smi pushes (105 vs 118 ms), so don't contort to keep kinds pure.

## 5. Prior art calibration

- **Fast tuned JS parsers live in the 100–350 MB/s band**: uDSV CSV parser 330 MiB/s untyped / 96 MiB/s typed vs PapaParse 186 MiB/s (https://github.com/leeoniya/uDSV README bench); my handrolled JSON 93–1393 MB/s depending on content mix; native JSON.parse itself is only 163–246 MB/s on object/number-heavy docs (strings 1 GB/s).
- **Chevrotain** claims it "can even compete with the performance of hand built parsers" with a hand-built JSON baseline in its benchmark (https://chevrotain.io/performance/, https://chevrotain.io/docs/features/blazing_fast.html, hand-built added after https://github.com/Chevrotain/chevrotain/issues/486) — i.e. even a framework reaches hand-parser speed via V8-focused tuning; a hand parser should never lose to one.
- **JS-source parsers**: meriyah ~2054 ops/s vs acorn 1411 vs esprima 1346 on identical input; ~3x acorn on bootstrap.min.js (https://github.com/prantlf/ecmascript-parser-benchmark, https://github.com/sveltejs/svelte/issues/4223) — even in mature niches, 3x wins from charCode-level engineering are normal.
- **No pure-JS simdjson exists** — only native bindings (https://github.com/luizperes/simdjson_nodejs) and a WASM-stage-1 discussion (https://github.com/simdjson/simdjson/discussions/1912); JS has no SIMD outside WASM, so structural-index bitmask tricks don't transfer; `indexOf` is the accessible SIMD proxy.
- **No pure-JS YAML parser beats js-yaml.** eemeli/yaml's own thread (https://github.com/eemeli/yaml/discussions/358): 500k-line file — js-yaml 504 ms vs yaml@1.10 2108 ms vs yaml@2 9584 ms; maintainer: "yaml handles its input in stages: lexing, parsing to a CST, composing an AST, and then converting to JS. It all adds up." (Counter-case: pathological anchor/merge yarn.lock where yaml@2 is 138x *slower* — 6900 ms vs 50 ms — so anchors/merge need an efficient path, not naive deep-copy.) yamljs is ~7–19x slower than js-yaml (https://github.com/jeremyfa/yaml.js/issues/132). Landscape: Bun ships native `Bun.YAML.parse` (docs say written in Rust, >90% yaml-test-suite: https://bun.com/docs/runtime/yaml); Deno's std/yaml is a js-yaml port (denoland/std lineage; README fetch was 404/403 — verify wording if cited publicly). **The "fastest pure-JS YAML parser" slot is open.**

## 6. Consolidated design implications

1. **Single-pass over a flat JS string**, `charCodeAt` dispatch + `indexOf` hops for newlines/quotes/comments/doc-markers; no separate token stream, no CST (that's eemeli/yaml's 15x tax), no bytes+TextDecoder (140 ns/call kills it for short scalars).
2. **`slice()` to materialize scalars/keys**; ≥13 chars is O(1); memoize rare-char positions (the next-backslash memo pattern fixed an O(n²) in bench3 — same applies to YAML escape/special scanning).
3. **First-char-gated scalar resolution inline with the scan; zero regex** on the hot path (js-yaml's per-scalar resolver chain is its biggest visible waste: loader.js:1566, float.js:6, schema/json.js:11).
4. **SMI int fast path** (digit accumulation), `+slice` only for floats.
5. **Key-string interning cache + consistent insertion order** → shared hidden classes; plain objects, `push`-built arrays, no `new Array(n)` for results.
6. **Many medium monomorphic functions**, not one megafunction (460-bytecode single-inline budget, 60KB never-optimize ceiling, whole-function deopt granularity); helpers ≤30 bytecode inline free.
7. Target/expectation setting: js-yaml = 18–29 MB/s here; JSON.parse = 163–246 MB/s on realistic docs. 60–120 MB/s is an evidence-backed goal; "at parity with JSON.parse" is only honest for string-heavy documents.

## KEY FACTS
- Best pure-JS JSON parser (jawj/json-custom-numbers) is typically 1.5-3x slower than native JSON.parse, faster than native on long-string inputs (0.73x) — https://github.com/jawj/json-custom-numbers
- Local ceiling test (bench3.mjs, Node 22.22.2/V8 12.4): handrolled JS JSON parser = 99 MB/s vs native 170 MB/s on mixed objects (1.71x), and BEATS native on string-heavy input (1393 vs 1057 MB/s)
- Competition on same machine/data (bench5.mjs): JSON.parse 172.8 MB/s, js-yaml.load 29.4 MB/s on JSON bytes / 18.1 MB/s on block YAML, eemeli yaml@2.9.0 only 1.5-1.9 MB/s — beating js-yaml needs ~30+ MB/s
- V8 SlicedString::kMinLength = 13 confirmed in v8/src/objects/string.h AND locally: str.slice is ~18ns (copy) at len 12, ~6.4ns O(1) at len 13+ (bench2.mjs)
- TextDecoder.decode has ~140-150 ns/call fixed overhead on small subarrays vs ~6-20 ns for str.slice — parse from the JS string, not from encoded bytes (bench2.mjs)
- String.prototype.indexOf runs at ~5 GB/s (SIMD memchr) vs ~0.5 GB/s charCodeAt loops on flat strings (356 MB/s on SlicedString, 301 on ConsString) — use indexOf for delimiter hops, keep source flat (bench1/bench2.mjs)
- V8 inlining budgets (main flag-definitions.h lines 1589-1615): 460 bytecode per inlinee, <=30-bytecode functions inline nearly always, and functions >60KB bytecode are NEVER TurboFan-optimized — avoid one-giant-function parser
- Fresh sliced key strings cost 3.3x vs interned keys when building objects (127 vs 39 ms/300k objs, bench4.mjs) — intern map keys via a cache; same-order same-key objects share hidden classes (v8.dev/blog/fast-properties)
- js-yaml runs an implicit resolver chain (null,bool,int,float+timestamp,merge — schema/json.js:11, schema/default.js:10) with regexes (type/float.js:6) per plain scalar (loader.js:1566); regex test alone measured 1.75x slower than first-char-gated charCode scan (bench2.mjs)
- No pure-JS YAML parser faster than js-yaml exists: eemeli/yaml is 4-19x slower (github.com/eemeli/yaml/discussions/358: 504ms vs 2108/9584ms), yamljs ~7x slower; Bun.YAML is native (Rust per bun.com/docs/runtime/yaml), Deno std/yaml is a js-yaml port