# Skipping the ref-scan with a single-pass, restart-on-share dumper

**Verdict: Worth pursuing** — the dumper's mandatory pre-scan of the whole value tree is
pure overhead on the common no-sharing input, and an optimistic single write pass that
falls back only when it actually meets a shared reference removes it byte-identically.

**Estimated benefit:** +5% to +35% stringify **CPU**, largest on **deep/nested
JSON-shaped data** (+35% on `large-nested`), a few percent on record arrays, and roughly
neutral on its own at the very largest (allocation-bound) sizes. Peak RSS is unchanged.
The benefit compounds with the key-quote cache — the combined `combo` result is reported
below.

**Rigor:** thorough experiment. A full prototype of the restart design, verified
byte-identical to current output across 22 cases including synthetic shared and cyclic
graphs, timed GC-between with medians of 40–400 samples.

*Part of the round-2 stringify studies; see [`./2026-07-14-json-performance-research-overview.md`](./2026-07-14-json-performance-research-overview.md) for
the whole set. It stacks with the key-quote cache in
[`./2026-07-14-stringify-speedup-via-key-caching.md`](./2026-07-14-stringify-speedup-via-key-caching.md); the `combo`
table here is the two landed together.*

## Background

`stringify` (`dumpValue`, `src/index.ts:4838`) is a two-pass design. The first pass,
`dumpScanRefs` (`src/index.ts:4399`), walks the **entire** value tree, ref-counting every
object into a `Map`. The second pass then writes, appending each line to a module-level
`out` string through `out += …` (a V8 ConsString rope) that is flattened once at the end;
the write helpers are `writeCollectionBody` (`src/index.ts:4732`) and `writeEntryValue`
(`src/index.ts:4766`).

The only reason the pre-scan exists is to place `&anchor` / `*alias` markers for
references that are shared between two or more parents, and to detect cycles. But the
overwhelmingly common input has no sharing at all: anything coming out of `JSON.parse` is
a tree by construction, and plain block-YAML without `&`/`*` is likewise a tree. On all
of that input the entire first pass is wasted — it walks every node, allocates a `Map`,
and discovers nothing worth marking.

The CPU profile confirms the cost is real and consistent. `dumpScanRefs` accounts for
about 9.7% to 13.4% of non-idle self-time across the fixtures:

| function | large-records | large-nested | xlarge-records |
| --- | ---: | ---: | ---: |
| **`dumpScanRefs` (the pre-scan)** | **11.4** | **13.4** | **9.7** |
| `(garbage collector)` | 7.5 | 17.0 | 44.0 |

The pre-scan is a steady ~10–13% tax. The garbage-collector row is the other half of the
story and explains why the payoff is uneven by size, as discussed below.

## Experiment

We prototyped an optimistic single write pass. It writes directly, with no pre-scan,
while tracking every object it has entered in a visited `Set`. If it ever reaches an
object already in the set — the first sign of genuine sharing or a cycle — it `throw`s a
module-constant restart sentinel, discards the partial output, and falls back to the
existing correct two-pass path (`dumpScanRefs` then write). On tree-shaped input the
sentinel never fires and the scan is simply never paid.

The correctness bar was byte-identical output. The prototype was verified byte-for-byte
equal to the current dumper across all 22 cases (6 JSON fixtures, 7 YAML fixtures
including `yaml-rich` with real `&`/`*` sharing, and 9 synthetic graphs including diamond
and cycle shapes), so the fallback demonstrably reproduces correct anchors and cycle
handling.

Timing used the same harness as the rest of this round: `performance.now()` per call,
`global.gc()` before every sample, medians of 40–400 samples, ratios against
`JSON.stringify` of the identical value. A methodology note that matters at scale: without
a GC between samples, `xlarge-records` (11.5 MB of output) reads as **25×**
`JSON.stringify`, because collection of the previous iteration's rope and temporaries
lands inside the timed region; with GC-between it reads **~8×**, matching the committed
BENCHMARKS.md figure of 8.05×. Every number here is GC-between. Because the machine was
shared during the session, absolute milliseconds are indicative and the ratios / profile
percentages / heap deltas are the robust signals. To measure the restart penalty on
genuinely shared input we used the `yaml-rich` fixtures, whose shared config pool turns
into thousands of aliases.

## Results

Baseline gap of the current dumper to `JSON.stringify` on this machine:

| fixture | JSON ms | ly ms | **× JSON** |
| --- | ---: | ---: | ---: |
| medium-records | 0.54 | 2.4 | **4.3–4.5** |
| large-records | 7.1 | 32 | **4.4–4.6** |
| xlarge-records | 62 | 500–570 | **8.0–8.9** |
| medium-nested | 0.95 | 3.7–4.0 | **3.8–4.1** |
| large-nested | 7.3 | 43–46 | **6.0–6.3** |

Single-pass-with-restart, as a percentage faster than `base` (GC-between medians), shown
next to the theoretical ceiling of simply not scanning at all (which is *incorrect* for
shared input and reported only as an upper bound):

| lever | medium-rec | large-rec | xlarge-rec | medium-nest | large-nest |
| --- | ---: | ---: | ---: | ---: | ---: |
| **single-pass, restart-on-share** (byte-identical) | +5–12% | +4–7% | −1 to +6% | +8–10% | **+35%** |
| ceiling: skip scan entirely (*incorrect* for sharing) | +12–16% | +11–20% | +11–17% | +13–19% | +44% |

The concentrated win is on nested data: +35% on `large-nested`, where the redundant
*traversal* of a deep tree — not allocation — was the dominant cost the pre-scan added.
Record arrays gain a few percent, and `xlarge-records` is roughly a wash on its own
(−1% to +6%). The reason for the xlarge wash is the visited `Set`: the correct design has
to keep a per-object structure alive to detect sharing, and that `Set` is essentially the
same size as the `Map` the pre-scan used to allocate. At `xlarge`, where garbage
collection is already 44% of the work, trading one allocation-heavy structure for another
nets near zero. The gap between the single-pass row and the skip-scan ceiling row is
exactly the cost of keeping that visited structure for correctness.

### Stacking with the key-quote cache: the `combo`

The single write pass and the key-quote cache from
[`./2026-07-14-stringify-speedup-via-key-caching.md`](./2026-07-14-stringify-speedup-via-key-caching.md) are independent
and compose. Together (`combo`) they measured, as a percentage faster than `base`:

| lever | medium-rec | large-rec | xlarge-rec | medium-nest | large-nest |
| --- | ---: | ---: | ---: | ---: | ---: |
| **single-pass + key-quote cache = `combo`** | **+22–28%** | **+16–23%** | **+10–11%** | **+23–29%** | **+46–48%** |

Expressed as the multiple of `JSON.stringify`, before and after:

| fixture | base × JSON | **combo × JSON** |
| --- | ---: | ---: |
| medium-records | 4.3 | **3.1** |
| large-records | 4.6 | **3.9** |
| xlarge-records | 8.6 | **7.7** |
| medium-nested | 4.0 | **3.1** |
| large-nested | 6.0 | **3.2** |

The headline movements are `large-nested` from 6.0× down to 3.2× and `xlarge-records` from
8.6× to 7.7×.

### Restart penalty on genuinely shared input

On the `yaml-rich` fixtures, which do trigger the fallback, the single-pass change alone
shows a small and variable penalty on the *tiny* `medium-rich` fixture (0–18%) and is
neutral on `large-rich` (−1%). The `combo` is net **faster** even on this shared input
(−9% to −11% versus base), because the key-quote cache also speeds up the two-pass
fallback path. In real shared data the first duplicate reference appears early, so almost
no write work is discarded before the restart fires — the restart is cheap in practice
rather than in theory.

### Memory

Peak RSS is essentially neutral. `xlarge-records` measured ~640 MB for single-pass versus
~620 MB for base, inside the ±3 MB-class noise once you account for size, and the retained
`heap Δ` is identical because output bytes are unchanged. An early −13% xlarge `combo`
reading turned out to be a single-sample low; the honest median is neutral. The mechanism
is intuitive: single-pass keeps its visited `Set` live *during* the rope build, whereas
the two-pass design frees its `Map` before writing, so the two roughly cancel on peak
footprint. The CPU wins here are RSS-free, but they do not by themselves close the 1.88×
`xlarge` peak-RSS gap to `JSON.stringify`.

## Interpretation & recommendation

The pre-scan is a real, measurable tax (~10–13% of CPU) that buys nothing on the common
tree-shaped input, and removing it correctly requires only a visited `Set` plus a
fallback for the rare shared case. The win lands most where the pre-scan's *traversal* was
the cost — deep nested trees, +35% — and is muted at `xlarge` only because that regime is
allocation-bound and the visited `Set` is an allocation of similar weight to the `Map` it
replaces. That is a coherent, mechanism-backed picture rather than noise.

Recommendation: implement it, and land it together with the key-quote cache. Estimated
benefit **+35% on nested, +5–7% on records, roughly neutral at xlarge on its own** at
**high confidence**, with the gain concentrated on deep/nested JSON-shaped data. Combined
with the cache the realistic landing is the `combo` above: **+10% to +48%**, moving
`large-nested` 6.0×→3.2× and `xlarge` 8.6×→7.7×.

How to apply, in `src/index.ts`:

- Replace the eager `dumpScanRefs` call in `dumpValue` with an optimistic write pass that
  tracks visited objects in a `Set` and `throw`s a restart sentinel on the first repeat.
  Split `dumpValue` into a fast path, a `dumpValueTwoPass` fallback (the current
  `dumpScanRefs` + write), and a shared `dumpFinish`. Add the visited-check at the top of
  the object branch in `writeEntryValue` (near line 4771) and `writeDocumentValue`
  (near line 4810). This is roughly 25 lines.
- Risks: (a) verify the sentinel `throw`/`catch` does not deoptimise the hot
  `writeEntryValue` — it measured fine here, and the key is to keep the sentinel a module
  constant rather than allocating one per call; (b) the visited `Set` is live during the
  output build, which is neutral on RSS in these measurements but should be re-checked
  with `pnpm bench:self`; (c) the small restart penalty on tiny shared inputs is
  acceptable and is offset by the key-quote cache.

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off
  main), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan), pnpm 10.33.0,
  build target ES2022 (tsup 8.5.1). Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
  All ms/ratios are from this machine.
- Deps used: yaml 2.9.0 — the reference library, used only to build the rich in-memory
  values behind the `yaml-rich` fixtures that exercise the restart fallback.
- Bench: bespoke node scripts (mitata not used here); GC between every sample (without
  which xlarge reads a false 25×); medians of 40–400 samples. CPU profile via
  `node --cpu-prof --cpu-prof-interval 150–200 --import tsx`, self-time as a percentage of
  non-idle samples. Memory via an isolated child process reading
  `process.resourceUsage().maxRSS` over 25 iterations, medians of 3.
- Fixtures: bench/fixtures/data/ (gitignored, reproducible via `pnpm gen:fixtures`).
- Ratios are the durable signal; absolute ms are machine-specific.
- Rigor of this study: thorough experiment (byte-identical across 22 cases).
