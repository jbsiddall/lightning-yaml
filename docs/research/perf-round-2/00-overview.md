# Round 2 — chasing `JSON.parse` / `JSON.stringify`

This is the index for the second round of performance research on `lightning-yaml`. The goal is
narrow and deliberate: get the parser and dumper as close as possible to the browser's **built-in
`JSON.parse` / `JSON.stringify`** — not to other YAML libraries, which we are already far ahead of —
for the **common case** of YAML that is effectively JSON (maps, sequences, strings, numbers,
booleans, null), possibly with multiline strings. Merge keys, tags, and anchors are treated as a
fringe that may take a slower path.

Each linked paper below is standalone and written the same way: it opens with a one-line **verdict**
and a rough benefit estimate, then walks through the theory, the experiment, the numbers, and the
recommendation, with the version/machine details in a footer. Read the abstract of any paper to get
the answer in a sentence; read the body for how that answer was reached.

Nothing here has been applied to `src/` yet — this round is measurement and analysis. The concrete
follow-up work is tracked in the private optimization backlog.

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
| Paper | Verdict |
| --- | --- |
| [stringify-01 — key-quote cache](./stringify-01-key-quote-cache.md) | **Worth pursuing** — +9–46% CPU, near-zero risk, biggest single lever |
| [stringify-02 — single-pass write with restart](./stringify-02-single-pass-restart.md) | **Worth pursuing** — +5–35%; stacked with 01 takes large-nested 6.0×→3.2× |
| [stringify-03 — rope vs array+join](./stringify-03-rope-vs-array-join.md) | **Not worth pursuing** — the current rope is 4–11% faster |
| [stringify-04 — number formatting](./stringify-04-number-formatting.md) | **Not worth pursuing** — `String(v)` is already optimal |
| [stringify-05 — one-scan scalar classifier](./stringify-05-multiline-classifier.md) | **Inconclusive** — clear win for string-heavy/multiline data, needs an end-to-end prototype |
| [stringify-06 — shape-codegen ceiling](./stringify-06-shape-codegen-ceiling.md) | **Reference / ceiling** — ~2.2–2.4× JSON, but Node-backend-only (see limitations) |

**Parse**
| Paper | Verdict |
| --- | --- |
| [parse-01 — number conversion](./parse-01-number-conversion.md) | **Not worth pursuing** — native `+string` is at the floor |
| [parse-02 — multiline/block baseline](./parse-02-multiline-parse-baseline.md) | **Worth pursuing** — multiline parses at ~3× JSON; `parseBlockScalar` is 47% of it, and rope-style accumulation is far faster on the hot pattern |
| [parse-03 — tiny-doc overhead](./parse-03-tiny-doc-overhead.md) | **Not worth pursuing** — the fixed per-call floor is small and flat across sizes |
| [parse-04 — string-length heuristic](./parse-04-length-heuristic-path-selection.md) | **Not worth pursuing standalone** — useful only as a size-gate for the heavy/future optimizations |

**Memory**
| Paper | Verdict |
| --- | --- |
| [memory-01 — value interning](./memory-01-value-interning.md) | **Worth pursuing** — −28% retained heap on repetitive records, parity-safe, at +16% parse cost |
| [memory-02 — columnar store + proxy facade](./memory-02-columnar-proxy-facade.md) | **Not worth pursuing** — the facade needed to keep the plain-object API costs more heap than it saves |
| [memory-03 — `Object.freeze`](./memory-03-object-freeze.md) | **Not worth pursuing** — no heap benefit, slower to build and to read, breaks the mutable-output contract |

**JIT & prior art**
| Paper | Verdict |
| --- | --- |
| [jit-01 — tier & deopt audit](./jit-01-tier-and-deopt-audit.md) | **Not worth pursuing** — a clean bill of health; every hot function already reaches the top JIT tier with no steady-state deopts |
| [survey — transferable techniques from other parsers](./survey-prior-art.md) | **Mixed** — runtime shape-codegen is worth pursuing for large homogeneous record arrays only; most memory ideas do not transfer |

## The shortlist worth applying

In rough order of value-for-effort (details and target lines are in each paper and the backlog):

1. **Stringify key-quote cache + single-pass write** ([01](./stringify-01-key-quote-cache.md) +
   [02](./stringify-02-single-pass-restart.md)) — together they take large-nested from 6.0× to 3.2×
   JSON.stringify and 1 MB records from ~4.5× to ~3.5×, at low risk and no code generation.
2. **Value interning for parse memory** ([memory-01](./memory-01-value-interning.md)) — about −28%
   retained heap on repetitive record arrays, parity-safe; the +16% parse cost argues for making it
   opt-in or cheapening the Map probe first.
3. **Multiline block-scalar parsing** ([parse-02](./parse-02-multiline-parse-baseline.md)) — the one
   parse-speed lever left, and it matters for the multiline common case; the fix mirrors the stringify
   rope insight (accumulate, don't array-join).
4. **One-scan scalar classifier** ([stringify-05](./stringify-05-multiline-classifier.md)) — helps the
   string-heavy/multiline dump path; worth an end-to-end prototype to confirm.

## Limitations and cross-cutting notes

- **Runtime codegen is Node-backend-only.** The shape-specialized serializer
  ([stringify-06](./stringify-06-shape-codegen-ceiling.md), survey A2) needs `new Function`, which a
  browser Content-Security-Policy without `'unsafe-eval'` blocks. So even though it is the biggest
  theoretical win, it applies only to Node backends (or sites that opt into `unsafe-eval`), not to the
  majority of the library's browser audience. It is future work behind the portable wins, not
  low-hanging fruit.
- **JIT tiering on this build.** On this Node 22.22.2 / V8 12.4 build, Maglev is compiled out, so the
  hot path runs Ignition → Sparkplug → **TurboFan**. The audit found every hot parse and dump function
  reaching TurboFan with no steady-state deopts — there is no tiering win to chase, and it confirms the
  gains above are not being silently deoptimized. (Some paper footers list the full tier chain
  including Maglev; it simply does not engage here.)
- **Rigor varies by paper, and each says so.** The stringify study and the survey were thorough; the
  parse, memory, and JIT reruns were deliberately **fail-fast / directional** (time-boxed to ~30
  minutes each) to get a quick read on where deeper work is warranted — every fail-fast paper is
  labelled as such and flags what a thorough follow-up would need.
- **Not yet applied.** No `src/` or `BENCHMARKS.md` changes were made this round; applying a finding is
  a separate task that must re-confirm the gain with `pnpm bench:self`. An adversarial critique pass
  over these papers is still outstanding.

## Provenance & sources

- Repo: lightning-yaml @ `0f6943e` (branch `claude/yaml-parser-perf-research-l73742`, off `main`),
  2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition → Sparkplug → TurboFan on this build; Maglev compiled out).
  pnpm 10.33.0. Build target ES2022 (tsup 8.5.1).
- Reference libraries, cited only where a claim depends on them: `yaml` 2.9.0 (used as an oracle to
  build rich in-memory values), `js-yaml` 5.2.1. Third-party library versions are cited in the survey.
- Machine for all first-party numbers: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5. Ratios are the
  durable signal; absolute milliseconds are machine-specific, and some reruns measured under
  concurrent load (noted per paper), where profile percentages, heap deltas, and ratios remain robust.
- Benchmark data is committed in-repo (`BENCHMARKS.md`); there is no separate data branch.
