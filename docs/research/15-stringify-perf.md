# 15-stringify-perf: halving the dumper's gap to `JSON.stringify`

```
Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off main), 2026-07-14.
Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan). pnpm 10.33.0. Build target ES2022 (tsup 8.5.1).
Reference lib (stringify oracle, for building rich in-memory values only): yaml 2.9.0. Bench: bespoke node scripts (mitata not used here).
Machine (THIS session): Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5. All ms/ratios below are from this machine.
Benchmark data: the committed gitignored fixtures in bench/fixtures/data/. Ratios are durable; absolute ms are machine-specific.
```

Companion to the round-2 overview [`14-perf-round-2-overview.md`](./14-perf-round-2-overview.md). This
doc covers **direction #1: stringify (dump) performance** — the weakest axis in the repo
(4–8× `JSON.stringify` on CPU, up to 1.9× its peak RSS), and the least-researched path.

## Context & hypothesis

`stringify` (`dumpValue`, src/index.ts:4838) is a two-pass design: `dumpScanRefs` (4399) walks the
**entire** value tree ref-counting every object into a `Map`, then a write pass (`writeCollectionBody`
4732 / `writeEntryValue` 4766) appends each line to a module-level `out` string via `out += …` (a
ConsString rope), flattened once at the end. The pre-scan exists solely to place `&anchor`/`*alias`
for shared references and cycles; the overwhelmingly common input (anything from `JSON.parse`, or
block-YAML with no `&`/`*`) has **no** sharing, so the whole scan is pure overhead there.

We hypothesised the biggest levers were: (1) skipping the ref-scan on no-sharing input; (2) the rope
vs. an array-of-chunks + `join`; (3) `Object.keys` per map; (4) per-scalar quote classification;
(5) multiline strings on the dump side (the owner's stated common case, previously **unmeasured**);
(6) an upper bound from shape-specialized codegen. Goal: quantify each honestly, keep or kill.

## Assumptions

- **Byte-identical output is the correctness bar.** Any prototype that isn't byte-for-byte equal to the
  current dumper on every fixture (and on synthetic shared/cyclic graphs) is a correctness bug, not a
  speed win, and is rejected. Every kept prototype below is verified byte-identical (22/22 cases:
  6 JSON + 7 YAML fixtures incl. `yaml-rich` with real sharing, + 9 synthetic incl. diamond/cycle).
- Target audience for wins: **JSON-shaped data (records / nested) at ≥1 MB dumped to YAML** — which by
  construction has no shared references (a `JSON.parse` result is always a tree).
- Steady-state, single-thread, warm JIT. Ratios vs `JSON.stringify` on the same in-memory value.

## Method

- **Baselines / A-B timing:** bespoke harness (`scratchpad/proto/lib.ts`) — `performance.now()` around
  each call, **`global.gc()` before every sample** (steady-state; see pitfall below), median of
  40–400 samples. Ratios reported vs `JSON.stringify` of the identical value.
  - *Methodology pitfall found & fixed:* without a GC between samples, xlarge (11.5 MB output) reads
    **25×** `JSON.stringify` — a measurement artifact: GC of the previous iteration's rope/temps lands
    inside the timed region. With GC-between it's **~8×**, matching the committed BENCHMARKS.md (8.05×).
    All numbers here are GC-between.
- **CPU profile:** `node --cpu-prof --cpu-prof-interval 150–200 --import tsx`. Note: tsx spawns a
  loader worker thread that also emits a `.cpuprofile`; the analyzer (`proto/prof-analyze.mjs`) picks
  the thread with our code and reports self-time as a % of **non-idle** samples.
- **Prototypes:** full `cp src/index.ts scratchpad/proto/dump-*.ts`, edit the dumper in the copy,
  import copy + untouched original into one process (each module keeps its own state), bench head-to-head.
- **Memory:** isolated child process (model of `bench/memory/worker.ts`), `--expose-gc`,
  `process.resourceUsage().maxRSS` over 25 iters; medians of 3 processes.
- Fixtures: `medium-records` (100 KB / 537 recs), `large-records` (1.2 MB / 6060), `xlarge-records`
  (10.7 MB / 54 054), `medium-nested` / `large-nested` (depth-6 trees), plus a constructed multiline
  corpus and the `yaml-rich` fixtures (shared config pool → aliases).

## Results

### Baseline (this machine) — current dumper vs `JSON.stringify`

| fixture | JSON ms | ly ms | **× JSON** |
| --- | ---: | ---: | ---: |
| medium-records | 0.54 | 2.4 | **4.3–4.5** |
| large-records | 7.1 | 32 | **4.4–4.6** |
| xlarge-records | 62 | 500–570 | **8.0–8.9** |
| medium-nested | 0.95 | 3.7–4.0 | **3.8–4.1** |
| large-nested | 7.3 | 43–46 | **6.0–6.3** |

Consistent with the committed competition block. The **xlarge cliff** (8× vs ~4.5× at 1 MB) is the tell:
at 11.5 MB output the process becomes **allocation-rate-bound**.

### CPU self-time (% of non-idle samples)

| function | large-records | large-nested | xlarge-records |
| --- | ---: | ---: | ---: |
| `writeCollectionBody` | 14.4 | 8.6 | 8.7 |
| `writeEntryValue` | 13.9 | 19.1 | 8.2 |
| `formatNumber` | 12.1 | 8.7 | 8.1 |
| **`dumpScanRefs` (the pre-scan)** | **11.4** | **13.4** | **9.7** |
| `dumpValue` (rope flatten + Map allocs) | 10.0 | 12.3 | 5.2 |
| `isPlainScalarSafe` + `tryNumberGeneric` + `writeStringScalar` | ~14 | ~5 | ~9 |
| **`(garbage collector)`** | **7.5** | **17.0** | **44.0** |

Reading: `dumpScanRefs` is a consistent **~10–13% pure tax**. GC is *the* story at xlarge (**44%**) and
already large on nested (17%) — i.e. **allocation rate**, not CPU work, dominates at scale. Structure
walking + number/scalar formatting make up the rest.

### Per-hypothesis prototype results (% faster than current `base`, GC-between medians)

| lever (verified byte-identical) | medium-rec | large-rec | xlarge-rec | medium-nest | large-nest |
| --- | ---: | ---: | ---: | ---: | ---: |
| **H1** single-pass, restart-on-share | +5–12% | +4–7% | −1 to +6% | +8–10% | **+35%** |
| **H1 ceiling** (skip scan; *incorrect* for sharing) | +12–16% | +11–20% | +11–17% | +13–19% | +44% |
| **H2** rope → array + `join` | −4% | **−11%** | −7% | −9% | +24%†|
| **H3+H4** key-quote cache | +19–22% | +15–18% | +9–13% | +23% | **+43–46%** |
| **H1+H3+H4 = `combo`** | **+22–28%** | **+16–23%** | **+10–11%** | **+23–29%** | **+46–48%** |

† large-nested H2 is the one positive for array-join and is **noise** — that fixture has the highest
GC share (17%) and run-to-run variance; on the other four fixtures array-join is **4–11% slower**.

**`combo` in absolute terms — × `JSON.stringify` before → after:**

| fixture | base × JSON | combo × JSON |
| --- | ---: | ---: |
| medium-records | 4.3 | **3.1** |
| large-records | 4.6 | **3.9** |
| xlarge-records | 8.6 | **7.7** |
| medium-nested | 4.0 | **3.1** |
| large-nested | 6.0 | **3.2** |

### H5 — multiline strings on the dump side (was unmeasured)

The dumper emits a string containing `\n` as a **double-quoted scalar with escaped `\n`**, *not* a
block scalar `|`:

```
description: "amet sed ipsum lorem do dolor\ndo adipiscing ipsum sed\n\neiusmod dolor do elit"
```

Same escaping shape as `JSON.stringify`. Measured on a constructed corpus (4000 records with a 3-line
`description`):

| corpus | base × JSON | combo × JSON |
| --- | ---: | ---: |
| multiline-records | **7.05** | 6.32 |
| plain-string-records | 4.97 | 4.11 |

Multiline is a genuine **weak spot (7×)** — worse than numeric records (4.5×) — because every
string value is scanned up to **three times**: `isPlainScalarSafe` (fails at the newline) →
`needsDoubleQuoting` (scans again) → `encodeDoubleQuoted` (scans again + builds a `parts` array +
`join`). A **one-scan classifier** (return PLAIN/SINGLE/DOUBLE from a single pass, merging steps 1–2)
is 1.8× faster than the current full classify on plain strings in isolation (9.7M→17.7M str/s) and
much faster on multiline (skips a redundant control-char scan). This is the lever for string-heavy data.

### H6 — shape-specialized codegen ceiling (records shape, **byte-identical**)

A hand-written serializer specialized to the `records` shape — what a runtime shape-detector
(fast-json-stringify style) would emit: keys are known-plain **constants** inlined, structure and field
order fixed, numbers formatted inline — **but still calling the real `writeStringScalar` per string
value** (mandatory: a value can look like a number and need quoting — e.g. the fixture's uuid
`444e-796234` is single-quoted because `tryNumberGeneric` reads it as `4.44e-796232`).

| fixture | base × JSON | **codegen ceiling × JSON** | headroom vs base |
| --- | ---: | ---: | ---: |
| medium-records | 4.3 | **2.24** | −47% |
| large-records | 4.6 | **2.38** | −49% |
| xlarge-records | 8.4 | **4.44** | −47% |

*(An earlier version hit 1.36× but was **not** byte-identical — it skipped the number-lookalike check,
i.e. cheated on the expensive part. The honest, byte-identical ceiling is ~2.2–2.4×.)*

### Memory (peak RSS, isolated child, medians of 3)

Peak RSS is **essentially neutral** across variants at large sizes (within ±3 MB noise):
large-records base 161 / combo 164 / keycache 159 MB; xlarge base ~620 / singlepass ~640 MB.
`heap Δ` (retained output string) is identical for all — output bytes are unchanged. The CPU wins are
**RSS-free**, but do **not** by themselves fix the 1.88× xlarge peak-RSS gap. (An early −13% xlarge
combo reading was a single-sample low; the honest median is neutral — single-pass keeps its visited
`Set` live *during* the rope build, whereas the two-pass frees its `Map` first, so the two roughly
cancel.)

### Restart cost on genuinely shared input (`yaml-rich`, triggers the fallback)

`singlepass` alone: small, variable penalty on the *tiny* medium-rich fixture (0–18%), neutral on
large-rich (−1%). `combo`: **net faster** even here (−9 to −11%), because the key cache also speeds the
two-pass fallback. The first duplicate reference in real shared data appears early, so almost no write
work is wasted before falling back — the restart is cheap in practice.

## Analysis

- **The unifying variable is allocation rate, not raw CPU.** GC is 44% of xlarge. Every per-line temp
  (`ind + "-"`, `" " + writeScalar(v) + "\n"`), every per-map `Object.keys` array, and the ref-count
  `Map` feed it. Levers that cut allocations (key cache: one cached `"key:"` string instead of
  re-building `key + ":"` every row; single-pass: one `Object.keys` per map instead of two — scan +
  write) help most exactly where the pain is.
- **H1 (skip scan) is real but capped by correctness.** The ceiling (just don't scan) is +11–44%, but
  preserving `&`/`*` and cycle semantics needs a visited structure. The correct single-pass-with-restart
  keeps a `Set` (≈ the `Map` it removes), so at the GC-bound xlarge it nets ~0 on its own; its big win
  is on **deep/nested** data (+35%), where the redundant *traversal* (not allocation) was the cost.
- **H3+H4 (key cache) was the sleeper and is the biggest single lever.** Records re-classify identical
  keys (`id`, `uuid`, …) once per row — 8 keys × 54 054 rows at xlarge. Nested trees have ~4 distinct
  keys (`node_0…3`) reused thousands of times → ~100% cache hit. It removes both the repeated
  `isPlainScalarSafe`+`tryNumberGeneric` classification **and** a per-row string concatenation. It
  mirrors the parser's own already-shipped FastKeyMatch (`publishRecordKeys` 1849) — the dump side
  simply never got the equivalent.
- **H2 (rope) is validated as-is — killing it is a NAY.** Array-`join` is 4–11% slower on 4/5 fixtures;
  the ConsString rope + single terminal flatten is genuinely the better choice, confirming the design
  comment at src/index.ts:4366. Don't touch it.
- **`formatNumber` looks big (8–12%) but is nearly irreducible.** In isolation, bare `String(v)` is
  only ~3% faster than the current guarded `formatNumber`, and an integer fast-path ~7% — i.e. <1%
  of total. `String(v)` is V8's optimal shortest-round-trip path. **NAY.**
- **H5:** multiline is the real, previously-hidden weak spot (7×). The fix is the one-scan classifier,
  not block scalars (the escaped-`\n` output is already correct and JSON-shaped).
- **H6:** a compiled dumper could reach ~2.2–2.4× JSON (≈ half the current cost), because it erases the
  entire per-node dispatch/recursion/`Object.keys`/depth-guard overhead. The residual 2× floor is
  irreducible per-string classification + the fact that YAML output is larger than JSON (more bytes to
  emit). High effort (runtime shape detection, `new Function`, cache + fallback, generated-code safety).

## Conclusion — **MIXED**, with two clear wins to ship now and a high-value ceiling

- **YAY — key-quote cache (H3+H4):** +9–46%, biggest single lever, trivial + low-risk. Ship.
- **YAY — single-pass with restart (H1):** +5–35% (huge on nested), byte-identical, restart penalty
  negligible in practice. Ship (stacks with the cache → `combo` = **+10% to +48%**, xlarge 8.6→7.7×,
  large-nested 6.0→3.2×).
- **NAY — rope→array/join (H2):** current rope is faster; keep it.
- **NAY — number formatting:** `String(v)` is near-optimal.
- **MIXED — one-scan scalar classifier (H5):** clear win for string-heavy/multiline data, medium
  confidence pending an end-to-end (not isolation) prototype; smaller for numeric records.
- **FUTURE / ceiling — shape codegen (H6):** ~2.2–2.4× JSON is achievable (~2× the headroom of
  `combo`), but it's a large, higher-risk build. Documented as the ceiling, not a now-change.

## How to apply

Ranked by (est. gain × confidence). Targets are in `src/index.ts`.

1. **Key-quote cache** — *high confidence, high gain.* In `writeCollectionBody` (4742–4748), memoize
   `writeStringScalar(k) + ":"` in a per-call `Map<string,string>` (init in `dumpValue` 4839, null it
   out at 4865). ~8 added lines. **Est. gain: +9% (xlarge) to +46% (large-nested); ~+18–22% on 1 MB
   records.** Audience: *all* map-bearing output; scales with key repetition (records, nested). Risk:
   near-zero — pure memoization of a pure function; keeps output byte-identical.
   *Watch:* the cache grows one entry per **distinct** key, so an input of millions of all-unique keys
   (rare) grows it O(distinct keys) — bound it with a size cap (stop inserting past, say, 10 000
   entries) exactly as a defensive measure; the parser's `keyCache` already lives with this shape.

2. **Single-pass write with restart-on-share** — *high confidence, gain concentrated on nested.*
   Replace the eager `dumpScanRefs` in `dumpValue` with an optimistic write pass that tracks visited
   objects in a `Set` and `throw`s a restart sentinel on the first repeat, falling back to the existing
   two-pass (`dumpScanRefs` + write) for correct anchors/cycles. ~25 lines (add a visited-check at the
   top of the object branch in `writeEntryValue` 4771 and `writeDocumentValue` 4810; split `dumpValue`
   into fast path + `dumpValueTwoPass` fallback + shared `dumpFinish`). **Est. gain: +35% nested,
   +5–7% records, ~0% xlarge alone** (but stacks with #1). Audience: deep/nested JSON-shaped data most.
   Risks: (a) verify the sentinel `throw`/`catch` doesn't deopt the hot `writeEntryValue` (measured
   fine here; keep the sentinel a module const, not created per call); (b) the visited `Set` is live
   during the output build — neutral on RSS here, but re-check peak RSS in `bench:self`;
   (c) small restart penalty on *tiny* shared inputs — acceptable, and offset by #1.

   Combined (#1+#2) is the recommended landing = the `combo` numbers above.

3. **One-scan scalar classifier (H5)** — *medium confidence.* Fold `isPlainScalarSafe` +
   `needsDoubleQuoting` into a single scan returning an enum {PLAIN, SINGLE, DOUBLE}; `writeStringScalar`
   (4626) switches on it. Removes one redundant full string scan for every quoted value. **Est. gain:
   material for string-heavy/multiline data (the 7× case), low single digits for numeric records.**
   Do this before/with any codegen. Risk: must preserve the exact `looksLikeTypedScalar`/`tryNumberGeneric`
   semantics — easy to get subtly wrong; gate on byte-identity across the fixtures + `test:stringify`.

4. **Shape-specialized codegen (H6)** — *future, high effort/high ceiling.* Ceiling ~2.2–2.4× JSON.
   Only worth it if the dumper becomes a headline metric; #1+#2 capture the cheap ~20–30% first.

**Do NOT** convert the rope to array+`join` (H2), and **do NOT** hand-optimize `formatNumber` — both
measured as non-wins.

## Reproduce

```bash
# machine facts
node -e "console.log(process.report.getReport().header.cpus[0].model)"
# all prototypes + harnesses live in the scratch dir used for this doc:
#   proto/lib.ts            shared timing (gc-between median)
#   proto/dump-*.ts         cp of src with one lever each (noscan/singlepass/join/keycache/combo/exports)
#   proto/check.ts          byte-identity vs src on 22 cases  (node --import tsx proto/check.ts <name> <mod>)
#   proto/compare3.ts       base vs singlepass/keycache/combo/ceiling      (--expose-gc --import tsx)
#   proto/multiline.ts      H5 multiline + plain-string corpora
#   proto/codegen-ceiling.ts H6 faithful (byte-identical) ceiling
#   proto/classify-micro.ts  one-scan classifier isolation
#   proto/mem-worker.ts     isolated peak-RSS probe
# CPU profile:
node --cpu-prof --cpu-prof-interval 200 --cpu-prof-dir <dir> --import tsx proto/prof-run.ts large-records 60
node proto/prof-analyze.mjs <dir>
```

Always GC between samples for large fixtures, or the xlarge cliff reads as a false 25×.
See also [`14-perf-round-2-overview.md`](./14-perf-round-2-overview.md).
