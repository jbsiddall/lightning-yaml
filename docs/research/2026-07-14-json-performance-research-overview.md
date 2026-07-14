# Performance research (round 2): chasing `JSON.parse` / `JSON.stringify`

This is the index for the second round of performance research on `lightning-yaml`. The goal is
narrow and deliberate: get the parser and dumper as close as possible to the browser's **built-in
`JSON.parse` / `JSON.stringify`** — not to other YAML libraries, which we are already far ahead of —
for the **common case** of YAML that is effectively JSON (maps, sequences, strings, numbers,
booleans, null), possibly with multiline strings. Merge keys, tags, and anchors are treated as a
fringe that may take a slower path.

Each linked note is standalone and written to the folder [`CONVENTIONS.md`](CONVENTIONS.md): it opens
with a **verdict** and a rough benefit estimate, says whether the work was a quick fail-fast probe or
a thorough experiment, then walks through the theory, the numbers, and the recommendation, with the
version and machine details in a footer. Read the abstract of any note for the one-sentence answer;
read the body for how that answer was reached.

Nothing here has been applied to `src/` yet — this round is measurement and analysis. The concrete
follow-up work is tracked in a private optimization backlog.

## The gaps we were chasing

Measured against built-in JSON (from `BENCHMARKS.md`):

| Area | Ratio vs JSON | Status after round 2 |
| --- | --- | --- |
| Stringify speed | 4–8× (worst 8.05× at 10 MB) | Two portable wins found; ~half the gap reachable |
| Stringify peak RSS | 1.5–1.9× at large sizes | Allocation-bound; CPU wins are RSS-neutral |
| Parse retained heap | 2.3–2.7× on medium records | Value interning recovers a large chunk, parity-safe |
| Parse speed | ~2× (multiline ~3×) | Multiline is the one open lever; the rest is at the floor |
| Parse peak RSS | ≤1.16× (parity) | Already solved |

## Findings at a glance

**Stringify** (the weak axis)

| Note | Verdict |
| --- | --- |
| [Caching rendered map keys](2026-07-14-stringify-speedup-via-key-caching.md) | **Worth pursuing** — +9–46% CPU, near-zero risk, biggest single lever |
| [Single-pass dumping with restart-on-share](2026-07-14-stringify-speedup-via-single-pass-dumping.md) | **Worth pursuing** — +5–35%; stacked with key caching, large-nested goes 6.0×→3.2× |
| [Output building: rope vs array-join](2026-07-14-stringify-string-building-rope-vs-join.md) | **Not worth pursuing** — the current rope is 4–11% faster |
| [Number formatting cost](2026-07-14-stringify-number-formatting-cost.md) | **Not worth pursuing** — `String(v)` is already optimal |
| [One-scan scalar classifier](2026-07-14-stringify-multiline-one-scan-classifier.md) | **Inconclusive** — clear win for string-heavy/multiline data, needs an end-to-end prototype |
| [Shape-specialized codegen ceiling](2026-07-14-stringify-codegen-speed-ceiling.md) | **Reference / ceiling** — ~2.2–2.4× JSON, but Node-backend-only (see limitations) |

**Parse**

| Note | Verdict |
| --- | --- |
| [Number conversion cost](2026-07-14-parse-number-conversion-cost.md) | **Not worth pursuing** — native `+string` is at the floor |
| [Multiline / block-scalar parsing](2026-07-14-parse-multiline-speedup-lever.md) | **Worth pursuing** — multiline parses at ~3× JSON; `parseBlockScalar` is 47% of it, and rope-style accumulation is far faster on the hot pattern |
| [Fixed overhead on tiny documents](2026-07-14-parse-tiny-document-overhead.md) | **Not worth pursuing** — the fixed per-call floor is small and flat across sizes |
| [Input-length path selection](2026-07-14-parse-length-based-path-selection.md) | **Not worth pursuing standalone** — useful only as a size-gate for the heavy/future optimizations |

**Memory**

| Note | Verdict |
| --- | --- |
| [Value interning](2026-07-14-memory-value-interning.md) | **Worth pursuing** — −28% retained heap on repetitive records, parity-safe, at +16% parse cost |
| [Columnar store + proxy facade](2026-07-14-memory-columnar-store-and-proxy-facade.md) | **Not worth pursuing** — the facade needed to keep the plain-object API costs more heap than it saves |
| [`Object.freeze`](2026-07-14-memory-object-freeze-effects.md) | **Not worth pursuing** — no heap benefit, slower to build and to read, breaks the mutable-output contract |

**JIT and prior art**

| Note | Verdict |
| --- | --- |
| [V8 JIT tiering & deopt audit](2026-07-14-jit-tiering-and-deopt-audit.md) | **Not worth pursuing** — a clean bill of health; every hot function already reaches the top JIT tier with no steady-state deopts |
| [Techniques from other parsers](2026-07-14-techniques-from-other-parsers.md) | **Mixed** — runtime shape-codegen is worth pursuing for large homogeneous record arrays only; most memory ideas do not transfer |

## The shortlist worth applying

In rough order of value-for-effort (details and target lines are in each note and the backlog):

1. **Stringify key caching + single-pass write** ([keys](2026-07-14-stringify-speedup-via-key-caching.md)
   + [single-pass](2026-07-14-stringify-speedup-via-single-pass-dumping.md)) — together they take
   large-nested from 6.0× to 3.2× JSON.stringify and 1 MB records from ~4.5× to ~3.5×, at low risk and
   with no code generation.
2. **Value interning for parse memory** ([note](2026-07-14-memory-value-interning.md)) — about −28%
   retained heap on repetitive record arrays, parity-safe; the +16% parse cost argues for making it
   opt-in or cheapening the Map probe first.
3. **Multiline block-scalar parsing** ([note](2026-07-14-parse-multiline-speedup-lever.md)) — the one
   parse-speed lever left, and it matters for the multiline common case; the fix mirrors the stringify
   rope insight (accumulate, don't array-join).
4. **One-scan scalar classifier** ([note](2026-07-14-stringify-multiline-one-scan-classifier.md)) —
   helps the string-heavy/multiline dump path; worth an end-to-end prototype to confirm.

## Directions we deliberately did not pursue

These were settled by the round-1 dossier and are not reopened here:

- **SIMD string operations** — `String.indexOf` is the only genuinely SIMD path (~13 GB/s memchr) and
  is already used for every long-run hop; `charCodeAt` is not SIMD; and character scanning is only
  ~8% of the parse budget. Nothing new to win here short of WASM. (See the
  [pure-JS speed ceiling](2026-07-12-pure-js-speed-ceiling.md) and
  [V8 `JSON.parse` anatomy](2026-07-12-v8-json-parse-anatomy.md) notes.)
- **Generic "allocate fewer objects"** — done, and shown to bottom out: a zero-intermediate-allocation
  parser still sat at ~1.62× JSON's RSS because V8's own construction path is cheaper than anything
  reachable from JS. (See the [adversarial verdicts](2026-07-12-adversarial-verdicts.md) note.)
- **WASM / native** — killed earlier: a native C++ YAML parser measured 45–48 MB/s, below the
  wasm-derate threshold. (See the [WASM route evaluation](2026-07-12-wasm-route-evaluation.md) note.)

## Limitations and cross-cutting notes

- **Runtime codegen is Node-backend-only.** The shape-specialized serializer
  ([codegen ceiling](2026-07-14-stringify-codegen-speed-ceiling.md),
  [survey](2026-07-14-techniques-from-other-parsers.md)) needs `new Function`, which a browser
  Content-Security-Policy without `'unsafe-eval'` blocks. So even though it is the biggest theoretical
  win, it applies only to Node backends (or sites that opt into `unsafe-eval`), not to the majority of
  the library's browser audience. It is future work behind the portable wins, not low-hanging fruit.
- **JIT tiering on this build.** On this Node 22.22.2 / V8 12.4 build, Maglev is compiled out, so the
  hot path runs Ignition → Sparkplug → **TurboFan**. The audit found every hot parse and dump function
  reaching TurboFan with no steady-state deopts — there is no tiering win to chase, and it confirms the
  gains above are not being silently deoptimized.
- **Rigor varies by note, and each says so.** The stringify study and the survey were thorough; the
  parse, memory, and JIT notes were deliberately **fail-fast / directional** (time-boxed to ~30
  minutes each) to get a quick read on where deeper work is warranted. Every fail-fast note is labelled
  as such and flags what a thorough follow-up would need.
- **Not yet applied.** No `src/` or `BENCHMARKS.md` changes were made this round; applying a finding is
  a separate task that must re-confirm the gain with `pnpm bench:self`. An adversarial critique pass
  over these notes is still outstanding.

## Provenance & sources

- Repo: lightning-yaml @ `0f6943e` (branch `claude/yaml-parser-perf-research-l73742`, off `main`),
  2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition → Sparkplug → TurboFan on this build; Maglev compiled out).
  pnpm 10.33.0. Build target ES2022 (tsup 8.5.1).
- Reference libraries, cited only where a claim depends on them: `yaml` 2.9.0 (used as an oracle to
  build rich in-memory values), `js-yaml` 5.2.1. Third-party library versions are cited in the survey.
- Machine for all first-party numbers: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5. Ratios are the
  durable signal; absolute milliseconds are machine-specific, and some notes measured under concurrent
  load (noted per note), where profile percentages, heap deltas, and ratios remain robust.
- Benchmark data is committed in-repo (`BENCHMARKS.md`); there is no separate data branch.
