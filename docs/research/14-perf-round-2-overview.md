# 14 — Perf research round 2: chasing `JSON.parse` / `JSON.stringify`

*Umbrella + index for the round-2 optimization studies (docs 15–19). Each linked doc is a
standalone engineering report; this page holds the shared context so they don't repeat it.*

```
Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off main), 2026-07-14.
Runtime: Node 22.22.2 / V8 12.4 (Ignition → Sparkplug → Maglev → TurboFan). pnpm 10.33.0.
Build target ES2022 (tsup 8.5.1). Reference libs (where cited): js-yaml 5.2.1, yaml 2.9.0. Bench: mitata 1.0.34.
Benchmark data: committed in-repo (BENCHMARKS.md) — no separate data branch/submodule. Its `competition`
and `self` blocks were generated on DIFFERENT machines with no SHA/date stamp, so treat RATIOS as the
durable signal and absolute MB/s as machine-specific. All new numbers in docs 15–19 are from the
maintainer's machine this session unless stated.
```

## Why this round

The parser is already heavily optimized (single-pass recursive descent, `charCodeAt` + a 256-entry
flag table, `indexOf` memchr-style hops, key interning, FastKeyMatch shape reuse, packed arrays, a
ConsString rope for the dumper). The goal here is narrow and specific:

- **Target = native `JSON.parse` / `JSON.stringify`**, not other YAML libraries. We are already far
  ahead of js-yaml and `yaml`; the interesting question is how close we can get to the browser's
  built-ins.
- **Optimize the common case:** YAML that is effectively JSON — maps, sequences, strings, numbers,
  booleans, null — *possibly with multiline strings*. Merge keys, tags, and anchors are fringe; it is
  acceptable for those to take a slower path.
- **Both axes:** CPU *and* memory, for *both* `parse` and `stringify`.

## What we're measuring against (baseline gaps, ranked by headroom)

From `BENCHMARKS.md` (competition block), lightning-yaml vs native JSON:

| Area | Ratio vs JSON | Verdict |
| --- | --- | --- |
| **Stringify speed** | **4–8×** (worst: xlarge-records **8.05×**) | The weak axis — biggest headroom |
| **Stringify peak RSS** | 1.5–1.9× at large/xlarge | Secondary target |
| **Parse retained heap** (heap-Δ) | 2.3–2.7× on medium records | The one parse-memory gap with room |
| **Parse speed** | ~2× (tiny docs 2.3× fixed overhead) | Already tight |
| **Parse peak RSS** | ≤1.16× (at parity) | Effectively solved |

Two honest caveats baked into this round:

- The oft-quoted *"medium JSON uses less memory than `JSON.parse`"* result is **measurement noise**
  (0.98× in one block vs 1.06× in another, different machines, inside Node's ~90 MB baseline). We
  report it as **parity**, not a win.
- **Multiline / block scalars were never benchmarked** — no committed fixture uses `|`/`>` or embedded
  newlines, yet that's part of the stated common case. Round 2 measures it for the first time.

## Directions we deliberately did *not* pursue (already settled)

- **SIMD string ops** — `String.indexOf` is the only real SIMD path (~13 GB/s memchr) and is already
  used for every long-run hop; `charCodeAt` is not SIMD; character scanning is only ~8% of the parse
  budget. Nothing new to win here short of WASM. (See docs 03, 05, 10.)
- **Generic "allocate fewer objects"** — done, and shown to bottom out: a zero-intermediate-allocation
  parser still sat at ~1.62× JSON's RSS because V8's own construction path is cheaper than anything
  reachable from JS. (Doc 10.)
- **WASM / native** — killed earlier (a native C++ YAML parser measured 45–48 MB/s, below the
  wasm-derate threshold). (Docs 04, 08, 10.)

## The five studies (index)

| # | Study | Status | One-line result |
| --- | --- | --- | --- |
| 15 | **[Stringify performance](15-stringify-perf.md)** | ✅ complete | Two ship-now wins take large-nested 6.0×→3.2× JSON; codegen ceiling ~2.2–2.4× |
| 16 | **Parse CPU + multiline** | ⏳ pending | Cut off at the session's 2-hour cap before writing up |
| 17 | **Compact in-memory representation** | ⏳ pending | Not started this session |
| 18 | **V8 JIT tier-residency & deopt audit** | ⏳ pending | Not started this session |
| 19 | **[Prior-art survey](19-prior-art-survey.md)** | ✅ complete | Runtime shape-codegen is worth it for large homogeneous record arrays only |

### 15 — Stringify performance (complete)
The dumper is the weak axis. Two low-risk wins, both prototype-verified **byte-identical** to the
current output across 22 cases (including shared/cyclic graphs):
1. **Key-quote cache** — memoize each `key + ":"` render instead of re-quoting per record. Biggest
   single lever: **+9% (xlarge) to +46% (nested)**, ~8 lines, near-zero risk.
2. **Single-pass write with restart-on-share** — drop the eager `dumpScanRefs` pre-walk; write
   optimistically and fall back to the two-pass path only if a shared reference is actually seen.
   **+35% nested**, stacks with #1.

Combined, large-nested goes **6.0× → 3.2×** JSON.stringify and 1 MB records ~4.5× → ~3.5×. The
**xlarge (10 MB) case is 44% GC-bound**, so CPU tweaks help it least (+10%); its 1.88× RSS gap needs
an allocation-side fix. A byte-identical **shape-specialized codegen** dumper could reach **~2.2–2.4×
JSON** but is larger, later work. Honest non-wins: replacing the rope with array+`join` is *slower*;
`formatNumber` is already near-optimal.

### 19 — Prior-art survey (complete)
Surveyed the formats the earlier dossier skipped — binary/schema serializers that lean on runtime
codegen. Verdict: **runtime shape-specialized codegen is worth prototyping, but only for large,
homogeneous, same-shape record arrays** (our 8.05× worst case); it's a net loss on small or
heterogeneous data. Evidence (third-party claims, versions cited, not independently reproduced):
fast-json-stringify 7.0.1 (1.6× objects / 2.4× short strings, but *slower* on large arrays),
protobuf.js 8.7.1 (runtime `new Function` reaches AOT-static speed), msgpackr 2.0.4 (~3.3× on *decode*
via object-literal construction that skips hidden-class transitions). Security lesson from avsc: our
map keys are untrusted input and must be passed as **data**, never interpolated into generated source.
The recommended first step is a **per-shape "record template" cache** that captures most of the codegen
benefit *without* `new Function` — which converges with study 15's key-quote cache.

### 16, 17, 18 — pending
This session ran under a 2-hour compute cap (owner's instruction). Studies 15 and 19 completed; the
parse-CPU/multiline study (16) was stopped mid-profiling at the cap, and the compact-representation
(17) and JIT-audit (18) studies had not started. They remain queued with full briefs; resuming them is
a follow-up.

## Methodology & integrity notes

- Ratios vs JSON are the durable signal; absolute timings drift and are machine-specific.
- Every prototype claiming a speed win was checked to produce **byte-identical** output to the current
  implementation on the fixtures — a faster-but-different dumper is a correctness bug, not a win.
- This round changed **no `src/` code** and did **not** refresh `BENCHMARKS.md`; prototypes lived in
  scratch. Applying the findings is deliberately a separate, later task (tracked in the private repo's
  optimization backlog).
- These docs have **not yet had the planned adversarial critique pass** — treat the estimated gains as
  well-measured single-machine prototypes, to be re-confirmed on a full `bench:self` run when applied.
