# Implementation-strategy research dossier (2026-07-12)

Deep research into how to implement `lightning-yaml`'s parser: what the
competition actually does, where `JSON.parse` really lives, whether WASM or
pure JS is the right substrate, and a ranked set of candidate designs.

Produced by a multi-agent Claude Code research session: 6 investigation
agents (source dives + web research + live micro-benchmarks), 3 competing
design agents, 12 adversarial verification agents (instructed to *refute*
the designs' load-bearing assumptions), and 1 completeness critic.
All local measurements ran on the session container — **Node v22.22.2 /
V8 12.4, 4-vCPU Xeon 2.80 GHz, 16 GB RAM** — absolute MB/s are
machine-specific; the ratios are the durable signal.

## Contents

| doc | what it is |
| --- | --- |
| [01-js-yaml-internals.md](01-js-yaml-internals.md) | js-yaml 4.3.0 loader anatomy: why it's fast, and 12 enumerated inefficiencies to exploit (file:line cites) |
| [02-eemeli-yaml-internals.md](02-eemeli-yaml-internals.md) | `yaml` (eemeli) 2.9.0 pipeline anatomy: why it's 15–100× slower and where 2.6 GB of RSS goes |
| [03-v8-json-parse.md](03-v8-json-parse.md) | V8's actual `JSON.parse` source (C++, `src/json/`): 8 techniques, each with a JS-replicability verdict |
| [04-wasm-route.md](04-wasm-route.md) | WASM feasibility: native lib landscape, boundary costs (measured), packaging, linear-memory/RSS |
| [05-pure-js-ceiling.md](05-pure-js-ceiling.md) | How fast pure JS can go on V8: ceilings, string/scan/JIT/object-building evidence |
| [06-local-microbenchmarks.md](06-local-microbenchmarks.md) | Calibration on this machine incl. a 166-line pure-JS JSON parser at 57–76 % of native |
| [07-design-a-pure-js.md](07-design-a-pure-js.md) | **Design A — pure-JS single-pass parser (recommended)** |
| [08-design-b-wasm.md](08-design-b-wasm.md) | Design B — WASM-wrapped rapidyaml + in-wasm YAML→JSON transcode (rejected on the numbers) |
| [09-design-c-hybrid.md](09-design-c-hybrid.md) | Design C — Design A + `JSON.parse` delegation router + tiered fast paths |
| [10-adversarial-verdicts.md](10-adversarial-verdicts.md) | 12 adversarial verifications: 9 confirmed, 3 refuted |
| [11-completeness-critique.md](11-completeness-critique.md) | Ranked gaps: what none of the designs handled (stringify! N-API! block-mode spike! …) |
| [12-v8-optimization-guide.md](12-v8-optimization-guide.md) | User-supplied V8 coding guide (tier model, JIT rules, tier-residency CI recipe), reviewed and edited to defer to the dossier's measurements |
| [13-adversarial-torture-tests.md](13-adversarial-torture-tests.md) | **Correctness under hostile input** (2026-07-13 addition): parser-differential taxonomy, CVEs, and lightning-yaml's measured verdict per construct — incl. two intentional divergences. Locked by `test/adversarial.unit.ts` |

## Executive summary

### Recommendation

**Pure JavaScript, skip WASM.** Build a single-pass, allocation-minimal,
`charCodeAt`-driven parser (Design A), then layer Design C's routing
discipline on top (flow fast paths always; the `JSON.parse` delegation
router as an honest, clearly-labelled extra). Projected **~3–3.5× faster
than js-yaml** at **~0.5–0.6× of native `JSON.parse`** on the JSON-bytes
fixtures — and *above* native on string-heavy input.

This is calibrated, not extrapolated: a 166-line pure-JS JSON parser
written during the research hit **57–76 % of native `JSON.parse` and beat
js-yaml 3.9× on identical bytes** on this machine, and an independent
verifier extended it with YAML flow syntax (comments, single quotes,
anchor/tag dispatch, plain scalars) and measured the YAML generality tax
at only **9–21 %** — still 3.0–3.6× js-yaml.

### Baseline measurements (identical JSON bytes)

| fixture | JSON.parse | js-yaml.load | yaml.parse |
| --- | --- | --- | --- |
| 106 KB | 182 MB/s | 26 MB/s (6.9× slower) | 1.8 MB/s (103× slower) |
| 1.2 MB | 180 MB/s | 25 MB/s (7.1×) | 1.6 MB/s (114×) |
| 10.7 MB | 135 MB/s | 24 MB/s (5.7×) | skipped (~8 s/parse extrapolated) |

### Why js-yaml beats `yaml`

One architectural decision: **zero intermediate representations** — a
single-pass recursive-descent composer writing final JS values directly.
`yaml` runs four stages through three nested generator layers
(Lexer → CST → Document tree → `toJS`); on a 10 MB doc its lexer alone
yields 3.86 M string tokens and takes 3× js-yaml's *entire* parse, and the
CST retains **733 MB (73× the input)**. The maintainer confirms the design
is intentional ("built for power rather than speed"). Meta-lesson for the
memory benchmark: **peak RSS tracks allocation *rate*, not live set**.

### js-yaml's own exploitable waste (our headroom)

Second validation pass per scalar; up-to-6-resolver chain with 3 regex
invocations per plain scalar; numbers string-materialized then parsed
2–3×; a 9-field snapshot object allocated per node (4.3.0); fully generic
flow path (~10 calls/element where one switch dispatch suffices);
speculative double-`composeNode` framing per block scalar; 1–2 full input
copies before parsing. See doc 01 for the full list with file:line cites.

### `JSON.parse` source (answered)

It lives in **V8** (which Chromium and Node vendor), written in **C++**:
[`src/json/json-parser.h`](https://github.com/v8/v8/blob/main/src/json/json-parser.h)
(542 lines) + `json-parser.cc` (2,259 lines), wired via
`src/builtins/builtins-json.cc`. Fully reusable from JS: 256-entry
char-class flag tables, zero-copy offset-recorded scalars with lazy
`slice`, the Smi digit-accumulation number path, recursion with an
iterative fallback. Partially reusable: hidden-class/key feedback
(FastKeyMatch → our key-intern cache + previous-sibling key comparison).
Not reusable: string-table internalization, write-barrier tricks, real
SIMD (Highway) — but `String.prototype.indexOf` runs at memchr/SIMD speed
(~5+ GB/s measured) and is the legal substitute; the `indexOf` hop is how
the research parser *beat* native on string-heavy input.

### Why WASM was rejected (measured, not vibes)

- Per-node object building across the boundary costs **~200 ms/10 MB**
  before any parsing (126 ns/callback + 130 ns/`TextDecoder.decode`) — dead.
- The only viable pipeline (swc/oxc-style in-wasm YAML→JSON transcode +
  native `JSON.parse`) makes `JSON.parse` a *component*, so approaching it
  is structurally impossible; best case ~1.4–2.1× js-yaml.
- Even that was **refuted**: native rapidyaml measured only **45–48 MB/s
  on the 10.7 MB fixture** (its ~150 MB/s claim doesn't transfer to
  node-dense record data); after the measured 1.45–2.5× wasm derate it
  lands at or below js-yaml.
- WASM linear memory never shrinks (verified +99 MB permanent RSS);
  best-case harness peak RSS ~330–430 MB — a thin win over js-yaml's
  495 MB, never near JSON's 282 MB.
- Feasibility itself is *confirmed* — a working 200 KB ryml wasm build with
  a YAML→JSON transcoder was produced during verification — it's the
  performance story that fails.
- The Rust landscape is a bonus argument: serde-yaml/unsafe-libyaml
  archived (Mar 2024), serde_yml unsound (RUSTSEC-2025-0068), saphyr
  unbenchmarked.

### Key facts for Design A (the winner)

- **One megafunction is harmful**: V8 never TurboFan-optimizes functions
  over 60 KB bytecode; inline budget is 460 bytecode/inlinee; ≤30-bytecode
  helpers inline free. Use many medium monomorphic functions, cold paths
  out-of-line.
- **Parse the JS string, not bytes**: `TextDecoder.decode` costs
  124–150 ns per short string vs 7–11 ns for `str.slice` (O(1)
  SlicedString at ≥13 chars — `kMinLength = 13` in V8's `string.h`).
  Raw scan-loop speed is contested (one agent measured string/byte parity,
  a verifier measured typed arrays 2.6–4.4× faster in TurboFan-verified
  loops) but scanning is only ~8 % of the budget; materialization
  dominates. Revisit only with profiler evidence.
- **Allocation elimination is the whole game** for speed *and* peak RSS —
  but the "JSON-class RSS" claim was **refuted**: an allocation-free JS
  JSON parser still peaked at 358 MB vs `JSON.parse`'s 220 MB under the
  exact harness, because JS-built object graphs *retain* ~1.6× more than
  V8-built ones (`push`-grown stores, transition-built shapes, sliced
  strings). Honest memory target: **~1.3–1.6× JSON's RSS, clearly below
  js-yaml, ~10× below `yaml`**.
- Scalar typing via first-char dispatch is real but second-order (regex
  dispatch measured only 1.14× worse); the first-order win is the
  architecture — no string materialization for non-strings, no resolver
  chain, no double parse.
- **js-yaml 5.2.1** (June 2026 TS rewrite, now npm `latest`; the repo's
  `^4.1.0` pin installs 4.3.0, the `v4-legacy` tag) was benchmarked
  head-to-head during verification: **parity with 4.x overall, 7–44 %
  slower on large fixtures, up to 2.6× the peak RSS**. Beating 4.3.0
  implies beating 5.2.1.

### The delegation router (Design C's Tier 0)

An 11.7 ns first-char sniff + `try { JSON.parse } catch { fullParse }` is
provably fail-safe (every YAML-only construct is a JSON syntax error) and
measured **1.000× `JSON.parse`** on the current fixtures — i.e. 7.5×
js-yaml with zero YAML code executing. Legitimate product feature
(JSON-through-YAML-loader pipelines); **illegitimate as the headline**,
since on the current flow-JSON fixtures it literally measures
`JSON.parse`. Requires: block-style fixture variants, a delegation-off
row, and the block table as the real win condition. Forces the
duplicate-key policy fork (js-yaml throws by default; JSON.parse is
last-wins; the yaml-test-suite does not require throwing).

### Top open items from the critique (doc 11)

1. **`stringify` is mandatory in the harness** (`Candidate` requires it;
   `bench:self` benches it) — no design covers a dumper.
2. **N-API native addon** route was never scored (no wasm derate, memory
   returned to OS; Node-only, per-platform prebuilds) — worth knowing,
   still capped by the same transcode ceiling.
3. **Block-mode throughput is 100 % extrapolation** — a 1–2 day spike
   (indent tracking + plain-scalar end detection + block maps on a
   `yaml.stringify`'d fixture) is the highest-value next measurement.
4. Alias/cycle semantics (`&a [*a]`, shared references) unspecced;
   security parity (`__proto__` guard, depth guard) unspecced; the
   committed heap-Δ column will expose SlicedString pinning of the source
   (~+10 MB on xlarge) unless flattening is chosen; fixtures contain zero
   escapes and zero non-ASCII bytes.

## Errata

- The micro-benchmark doc (06) labels the installed js-yaml as 4.1.0; the
  actually-installed version is **4.3.0** (pnpm resolved `^4.1.0` →
  4.3.0). All "js-yaml" numbers in this dossier were measured against
  4.3.0. Independently verified in docs 01, 10, 11.
- Doc 05 measured Uint8Array scanning ~1.5× faster than `charCodeAt`;
  doc 06 measured parity; the adversarial pass (doc 10) reproduced a
  2.6–4.4× typed-array advantage in TurboFan-verified loops. The
  discrepancy is unreconciled (loop structure/opt-status differences);
  the string-substrate decision does not rest on it (see doc 07 §1 and
  the summary above).
