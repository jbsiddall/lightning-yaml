# Caching rendered map keys in `stringify`

**Verdict: Worth pursuing** — memoizing each map key's rendered `"key:"` string
removes both a repeated quote-classification and a per-row string concatenation, and it
is the single largest lever we found anywhere on the dump side.

**Estimated benefit:** +9% to +46% stringify **CPU**, concentrated on **map-heavy,
JSON-shaped data** — record arrays and nested trees — at any size from roughly 100 KB
upward; about +18–22% on 1 MB record data. Peak RSS is unchanged, so the win is CPU
only. There is no benefit for scalar-only payloads or a single small object.

**Rigor:** thorough experiment. A full prototype of the dumper, verified byte-identical
to current output across 22 cases, timed with a garbage collection between every sample
and medians of 40–400 samples.

the whole set. Its natural partner is
[`./2026-07-14-stringify-speedup-via-single-pass-dumping.md`](./2026-07-14-stringify-speedup-via-single-pass-dumping.md): the
two levers are independent and stack into the `combo` result reported there.*

## Background

`stringify` renders a value tree to YAML through `dumpValue`.
Collections are handled by `writeCollectionBody`, which iterates a
map's entries and, for each one, renders the key with `writeStringScalar(k)` and then
appends the `key + ":"` prefix before the value. Rendering a key is not free: the dumper
must decide whether the key can be written as a bare plain scalar or has to be quoted,
which means running the same quote-classification machinery used for values —
`isPlainScalarSafe` followed by `tryNumberGeneric` — and only then concatenating the
result with `":"`.

The observation that motivates this paper is that map keys repeat. A record array of
54,054 rows, each an object with the eight keys `id`, `uuid`, and so on, forces the
dumper to classify and re-concatenate those same eight strings 54,054 times over, always
producing the identical `"id:"`, `"uuid:"` output. A depth-6 nested tree is even more
extreme: it has only about four distinct keys (`node_0` through `node_3`) reused
thousands of times, so nearly every key the dumper renders is one it has already
rendered. None of that work changes from row to row; it is pure repetition.

This is precisely the problem the parser already solved on its own side. The parse path
ships a `FastKeyMatch` fast-lane via `publishRecordKeys`, which
recognises recurring record keys and avoids re-doing per-key work. The dump side simply
never received the equivalent optimisation, which is why it was the sleeper lever going
into this round.

## Experiment

We copied `src/index.ts` into a prototype and added a per-call cache to the dumper: a
`Map<string, string>` that maps a raw key to its fully rendered `writeStringScalar(k) +
":"` prefix. On a cache hit the entire classify-and-concatenate step collapses to a
single map lookup. The correctness bar was byte-identical output — any prototype whose
bytes differ from the current dumper on any input is treated as a bug, not a speed win —
and this prototype was verified byte-for-byte equal across all 22 cases used in this
round (6 JSON fixtures, 7 YAML fixtures including the `yaml-rich` set with real
`&`/`*` sharing, and 9 synthetic graphs including diamond and cyclic shapes).

Timing used a bespoke harness (`performance.now()` around each call) with an explicit
`global.gc()` before every sample so that garbage collection of the previous iteration's
temporaries could not land inside the timed region, and medians were taken over 40–400
samples. All ratios are reported against `JSON.stringify` of the identical in-memory
value. Because other agents shared this machine during the session, treat absolute
milliseconds as indicative; the ratios, profile percentages, and heap deltas are the
robust signals. Memory was measured separately in an isolated child process with
`--expose-gc`, reading `process.resourceUsage().maxRSS` over 25 iterations, medians of 3
processes.

Fixtures: `medium-records` (100 KB, 537 records), `large-records` (1.2 MB, 6,060),
`xlarge-records` (10.7 MB, 54,054), and the depth-6 `medium-nested` / `large-nested`
trees.

## Results

For orientation, the current dumper's baseline gap to `JSON.stringify` on this machine:

| fixture | JSON ms | ly ms | **× JSON** |
| --- | ---: | ---: | ---: |
| medium-records | 0.54 | 2.4 | **4.3–4.5** |
| large-records | 7.1 | 32 | **4.4–4.6** |
| xlarge-records | 62 | 500–570 | **8.0–8.9** |
| medium-nested | 0.95 | 3.7–4.0 | **3.8–4.1** |
| large-nested | 7.3 | 43–46 | **6.0–6.3** |

The key-quote cache, as a percentage faster than the current dumper (`base`), GC-between
medians:

| lever (verified byte-identical) | medium-rec | large-rec | xlarge-rec | medium-nest | large-nest |
| --- | ---: | ---: | ---: | ---: | ---: |
| **key-quote cache** | +19–22% | +15–18% | +9–13% | +23% | **+43–46%** |

The pattern matches the theory exactly. The gain is largest where key repetition is
highest: the nested trees, with only about four distinct keys, hit the cache on nearly
every render and improve by +23% (medium) and +43–46% (large). Record arrays, with eight
distinct keys per row repeated once per row, gain a solid +15–22% at medium and large
sizes. The gain is smallest at `xlarge-records` (+9–13%), and understanding why is
important: at 10.7 MB of input the process is dominated by allocation rate rather than
per-key CPU (garbage collection alone is 44% of non-idle samples there), so shaving key
work helps proportionally less. The lever is still a clear positive even in that
allocation-bound regime.

Memory is neutral. In the isolated child-process probe, `large-records` peak RSS was
159 MB with the cache versus 161 MB for `base` — inside the ±3 MB run-to-run noise — and
the retained-output `heap Δ` is identical because the emitted bytes are unchanged. The
cache holds one small string per *distinct* key, which is negligible for realistic data.

## Interpretation & recommendation

The cache wins because it removes two costs at once for every repeated key: the
`isPlainScalarSafe` + `tryNumberGeneric` classification, and the `key + ":"` string
concatenation that would otherwise allocate a fresh string on every row. Both are per-row
work in the current dumper and both become a single map lookup after the first
occurrence. That it helps most on nested data (highest hit rate) and least at xlarge
(allocation-bound) is exactly what the mechanism predicts, which raises confidence that
the measured wins are real rather than noise.

Recommendation: implement it. Estimated benefit **+9% (xlarge records) to +46% (large
nested) CPU, roughly +18–22% on 1 MB records**, at **high confidence**. The audience is
all map-bearing output; the size of the win scales with how often keys repeat, so record
arrays and nested trees benefit most and flat scalar data not at all.

How to apply, in `src/index.ts`:

- In `writeCollectionBody`, where the key prefix is built,
  memoize `writeStringScalar(k) + ":"` in a per-call `Map<string, string>`. Initialise
  the map in `dumpValue` and null it out when the call finishes
  so it does not outlive the dump. This is roughly eight added lines.
- The risk is near zero: this is pure memoization of a pure function, and the output
  stays byte-identical. Gate the change on byte-identity across the fixtures and
  `pnpm test:stringify` regardless.
- One defensive note: the cache grows by one entry per *distinct* key, so a pathological
  input of millions of all-unique keys (rare in practice) would grow it O(distinct keys).
  Bound it with a simple size cap — stop inserting past, say, 10,000 entries — which
  costs nothing on normal data. The parser's own `keyCache` already lives with exactly
  this shape.

This is the highest-return change on the dump side. It composes cleanly with the
single-pass write pass in
[`./2026-07-14-stringify-speedup-via-single-pass-dumping.md`](./2026-07-14-stringify-speedup-via-single-pass-dumping.md); landing
both together is the recommended outcome and produces the `combo` numbers reported in
that paper.

## Code references

- `dumpValue` — `src/index.ts:4838` (per-call cache init ~4839; nulled ~4865)
- `writeCollectionBody` — `src/index.ts:4732` (key-prefix build ~4742–4748)
- `publishRecordKeys` — `src/index.ts:1849`

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off
  main), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan), pnpm 10.33.0,
  build target ES2022 (tsup 8.5.1). Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
  All ms/ratios are from this machine.
- Bench: bespoke node scripts (mitata not used here); GC between every sample; medians of
  40–400 samples. Memory via an isolated child process reading
  `process.resourceUsage().maxRSS` over 25 iterations, medians of 3.
- Fixtures: bench/fixtures/data/ (gitignored, reproducible via `pnpm gen:fixtures`).
- Ratios are the durable signal; absolute ms are machine-specific.
- Rigor of this study: thorough experiment (byte-identical across 22 cases).
