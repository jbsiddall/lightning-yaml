> Produced by a multi-agent research session (Claude Code). All local numbers were measured on the session container — Node v22.22.2 / V8 12.4, 4-vCPU Xeon 2.80 GHz, 16 GB RAM; absolute MB/s are machine-specific, ratios are the durable signal. Referenced `scratchpad/*.mjs` scripts were session throwaways and are not committed.

# Empirical calibration: lightning-yaml target machine

## Machine / runtime context

| | |
|---|---|
| CPU | Intel(R) Xeon(R) Processor @ 2.80GHz, 4 vCPU (`/proc/cpuinfo`) |
| RAM | 16 GB (15.3 GB available), machine otherwise quiet |
| OS / arch | Linux 6.18.5, x64 |
| Node | **v22.22.2**, V8 12.4.254.21-node.39 |
| Deps | js-yaml **4.1.0**, yaml **2.9.0** (repo node_modules via pnpm symlinks) |

Fixtures (generated via `pnpm gen:fixtures`; defs at `/home/user/lightning-yaml/bench/fixtures/datasets.ts:26-33`, files in `bench/fixtures/data/`): small-records 952 B, medium-records 106,002 B, large-records 1,197,623 B, xlarge-records 10,728,911 B, medium-nested 168.9 KB, large-nested 1,251,846 B. All fixtures are pure-ASCII JSON (chars == utf8 bytes).

Method: `performance.now()`, 10-30 warm iterations (3 for xlarge), batch calibrated to >=60-100 ms, **median of 5-9 measured reps**, result objects consumed into a sink to defeat DCE. Scripts (throwaway, not committed): `/tmp/claude-0/-home-user-lightning-yaml/5b5afb90-7c63-5a56-af0b-8798d3e9b488/scratchpad/{bench-util,a-parsers,b-scan,minijson,c-minijson-bench,d-typing,d2-baseline,e-substr}.mjs`.

## (a) JSON.parse vs js-yaml.load vs yaml.parse (identical JSON bytes)

| fixture | parser | ms/op (median) | ops/s | MB/s | x slower than JSON.parse |
|---|---|---:|---:|---:|---:|
| small-records (952 B) | JSON.parse | 0.0053 | 189,736 | 180.6 | 1.00 |
| | js-yaml.load | 0.0357 | 28,018 | 26.7 | **6.77** |
| | yaml.parse | 0.4652 | 2,150 | 2.0 | **88.3** |
| medium-records (106 KB) | JSON.parse | 0.581 | 1,721 | 182.4 | 1.00 |
| | js-yaml.load | 4.016 | 249.0 | 26.4 | **6.91** |
| | yaml.parse | 59.91 | 16.7 | 1.8 | **103.1** |
| large-records (1.20 MB) | JSON.parse | 6.661 | 150.1 | 179.8 | 1.00 |
| | js-yaml.load | 47.53 | 21.0 | 25.2 | **7.14** |
| | yaml.parse | 760.5 | 1.3 | 1.6 | **114.2** |
| large-nested (1.25 MB) | JSON.parse | 8.915 | 112.2 | 140.4 | 1.00 |
| | js-yaml.load | 53.47 | 18.7 | 23.4 | **6.00** |
| | yaml.parse | 755.1 | 1.3 | 1.7 | **84.7** |
| xlarge-records (10.73 MB) | JSON.parse | 79.78 | 12.5 | 134.5 | 1.00 |
| | js-yaml.load | 455.4 | 2.2 | 23.6 | **5.71** |
| | yaml.parse | *skipped per task* (extrapolates to ~7-8 s/op) | | | |

## (b) Raw scan ceilings (large-records, 1,197,623 B)

| loop | ms/pass | MB/s |
|---|---:|---:|
| `sum += s.charCodeAt(i)` over string | 0.954 | **1,255** |
| `sum += u8[i]` over Uint8Array | 0.956 | **1,253** |
| `TextEncoder.encode(s)` (whole string) | 0.358 | **3,350** |

## (c) KEY OUTPUT — minimal pure-JS recursive-descent JSON parser vs native

Parser: `scratchpad/minijson.mjs`, 166 lines. charCodeAt scanning, module-level state (no per-parse closures), `str.slice` for escape-free strings + slow path with `\uXXXX`, manual int accumulation (<=15 digits) + `Number(slice)` fallback for floats/exponents/bignums, plain `{}`/`[]` building. **Correctness: `assert.deepStrictEqual` vs `JSON.parse` PASSED on all 5 fixtures plus an escape/unicode/bignum torture case.** (It does not do exhaustive spec validation, so treat as a mildly optimistic ceiling.)

| fixture | native JSON.parse | minijson (pure JS) | minijson MB/s | **% of native** |
|---|---:|---:|---:|---:|
| small-records | 0.0054 ms | 0.0093 ms | 102.0 | **57.4%** (1.74x slower) |
| medium-records | 0.598 ms | 1.017 ms | 104.3 | **58.8%** (1.70x) |
| large-records | 7.275 ms | 12.200 ms | 98.2 | **59.6%** (1.68x) |
| large-nested | 9.785 ms | 12.814 ms | 97.7 | **76.4%** (1.31x) |

Pure-JS ceiling on this machine: **~100 MB/s**, i.e. 57-60% of native on flat records, 76% on deeply-nested (native slows on nested; the JS parser doesn't). The same parser is **~3.9x faster than js-yaml** on the identical bytes (12.2 ms vs 47.5 ms on large-records).

## (d) Per-scalar typing cost (1e6 short strings: 1/3 ints, 1/3 4-dp floats, 1/3 words; median of 7)

| dispatch strategy | gross ns/op | net ns/op (minus 3.2 ns loop baseline) |
|---|---:|---:|
| regex `INT_RE.test` then `FLOAT_RE.test` + parseInt/parseFloat (js-yaml-ish) | 54.5 | ~51.3 |
| first-char charCode dispatch + manual digit scan (+`Number()` for floats) | 47.7 | ~44.5 |
| ratio | **1.14x** | ~1.15x |

Surprise: regex dispatch is only ~7 ns/scalar worse — V8's Irregexp is fast, and the *number conversion* (parseFloat/`Number(slice)`) dominates both paths. So js-yaml's 6-7x deficit is architectural (char-by-char state machine, multi-candidate resolver loop, intermediate buffers), not its regexes. FWIW js-yaml's int resolver is actually a char loop and only float uses a regex (`node_modules/js-yaml/lib/type/int.js:20`, `node_modules/js-yaml/lib/type/float.js:6,27`).

## (e) Substring materialization (rotating offsets into the 1.2 MB string; median of 5)

| operation | ns/op | notes |
|---|---:|---|
| `s.slice(a, a+8)` | 11.1 | 1e7 iters; < V8 SlicedString::kMinLength(13) → heap copy (SeqString) |
| `s.slice(a, a+20)` | **7.1** | 1e7 iters; >=13 chars → SlicedString view, no copy — *cheaper than the 8-char slice* |
| `String.fromCharCode.apply(null, arr8)` | 49.3 | 1e7 iters; incl. 8 charCodeAt reads (~10 ns) → net ~39 ns |
| `TextDecoder.decode(u8.subarray(a, a+8))` | 124.4 | 1e6 iters; per-call overhead — prohibitive per-token |
| baseline: offset math + 8x charCodeAt only | 10.1 | 1e7 iters |

## Conclusions

1. **Hand-written 166-line pure-JS JSON parser reached 57-60% of native JSON.parse on flat 100KB-1MB fixtures and 76% on nested 1MB (~100 MB/s absolute)** — that is the realistic pure-JS ceiling on this machine.
2. **js-yaml is 5.7-7.1x slower than JSON.parse here (23-27 MB/s flat across sizes)**; the minijson-style architecture already beats js-yaml ~3.9x on identical bytes, so "clearly beat js-yaml on speed" has ~4x headroom.
3. **yaml@2.9.0 is 85-114x slower than JSON.parse (1.6-2.0 MB/s)** — irrelevant as a speed competitor; skipping its 10 MB case was correct (~8 s/parse extrapolated).
4. **Raw charCodeAt scanning runs at 1,255 MB/s** — a single-pass tokenizer spends only ~8% of the pure-JS parser's budget on character reads; value materialization (object/property/string/number building) is where the other ~92% goes.
5. **Uint8Array byte scanning is NOT faster than string charCodeAt (1,253 vs 1,255 MB/s) on Node 22/V8 12.4**, and TextDecoder costs ~124 ns per short-string decode — parse the JS string directly; do not transcode to bytes.
6. **`s.slice` is the cheapest string materialization: 11.1 ns (8 chars, copied) / 7.1 ns (20 chars, SlicedString)**; `String.fromCharCode.apply` is ~4x worse and `TextDecoder.decode` ~11x worse — build every token via slice, use the escape-free fast path.
7. Note the SlicedString retention hazard: 20-char slices are views keeping the whole source alive — fine for parse-and-drop benchmarks, relevant to the peak-memory goal.
8. **Regex scalar dispatch costs 54.5 ns vs 47.7 ns for charCode dispatch (only 1.14x)** — plain-scalar typing tactics are second-order; the win over js-yaml must come from single-pass architecture, not resolver micro-tuning. Number conversion (`Number(slice)`/parseFloat, ~20-30 ns) is the dominant per-scalar cost; the manual int accumulator fast path avoids it for integers.
9. **JSON.parse itself runs at ~180 MB/s (flat) / 128-140 MB/s (nested/xlarge) here, with ~5.3 µs per-call floor on a 1 KB doc** — use these as the absolute reference lines for README targets.
10. Timings are stable run-to-run within ~±5% (medians of 5-9 reps); all scripts live under the scratchpad and nothing in the repo was modified.

## KEY FACTS
- Node v22.22.2 / V8 12.4.254.21, Intel Xeon @2.80GHz 4 vCPU, 16GB RAM, Linux x64 (node --version; /proc/cpuinfo)
- KEY RATIO: 166-line pure-JS recursive-descent JSON parser (scratchpad/minijson.mjs) hit 59.6% of native JSON.parse on the 1.2MB flat fixture (12.20 vs 7.27 ms), 58.8% on 106KB, 76.4% on nested 1.25MB — pure-JS ceiling ~100 MB/s; deepStrictEqual-verified vs JSON.parse on all fixtures (scratchpad/c-minijson-bench.mjs output)
- js-yaml@4.1.0 is 5.7-7.1x slower than JSON.parse on identical JSON bytes, flat ~23-27 MB/s at every size (scratchpad/a-parsers.mjs output)
- yaml@2.9.0 is 85-114x slower than JSON.parse (1.6-2.0 MB/s; 760 ms for 1.2MB) — xlarge skipped for it as instructed (scratchpad/a-parsers.mjs output)
- Native JSON.parse baseline on this machine: ~180 MB/s flat records, 128-140 MB/s nested/xlarge, ~5.3 us/call on the 952B fixture (scratchpad/a-parsers.mjs, c-minijson-bench.mjs)
- Raw scan ceilings on 1.2MB fixture: string charCodeAt loop 1255 MB/s, Uint8Array byte loop 1253 MB/s (no byte advantage), TextEncoder.encode 3350 MB/s (scratchpad/b-scan.mjs output)
- Scalar typing: regex.test dispatch 54.5 ns/op vs charCode dispatch 47.7 ns/op over 1e6 mixed int/float/word scalars (loop baseline 3.2 ns) — only 1.14x apart; conversion cost dominates (scratchpad/d-typing.mjs, d2-baseline.mjs)
- Substring materialization: s.slice 8-char 11.1 ns (copied), 20-char 7.1 ns (SlicedString, >=13-char threshold); String.fromCharCode.apply(8) 49.3 ns; TextDecoder.decode of 8-byte subarray 124.4 ns/call (scratchpad/e-substr.mjs output)
- Fixtures are all-ASCII JSON: small 952B, medium 106,002B, large 1,197,623B, xlarge 10,728,911B, large-nested 1,251,846B (bench/fixtures/datasets.ts:26-33; gen:fixtures output)
- js-yaml resolves ints with a char loop, floats with a regex (node_modules/js-yaml/lib/type/int.js:20, lib/type/float.js:6,27) — its 6-7x deficit is architectural, not regex cost
## Corrections & cross-note reconciliation

- **js-yaml version.** This note labels the installed js-yaml as 4.1.0, but the actually-installed
  version is **4.3.0** (pnpm resolved `^4.1.0` → 4.3.0). All "js-yaml" numbers here were measured
  against 4.3.0 — independently verified in the [js-yaml internals](2026-07-12-js-yaml-internals.md),
  [adversarial verdicts](2026-07-12-adversarial-verdicts.md), and
  [completeness critique](2026-07-12-completeness-critique.md) notes.
- **Uint8Array vs `charCodeAt` scanning.** The
  [pure-JS speed ceiling](2026-07-12-pure-js-speed-ceiling.md) note measured Uint8Array scanning
  ~1.5× faster than `charCodeAt`; this note measured parity; the
  [adversarial verdicts](2026-07-12-adversarial-verdicts.md) pass reproduced a 2.6–4.4× typed-array
  advantage in TurboFan-verified loops. The discrepancy is unreconciled (loop structure and
  optimization-status differences), and the decision to parse from a JS string rather than from bytes
  does not rest on it (see the [pure-JS parser design](2026-07-12-design-a-pure-js-parser.md), §1).
