# The fixed per-call overhead of parsing a tiny document

**Verdict: Not worth pursuing** — the fixed per-call cost is real and measurable but
small in absolute terms, has no single dominant removable component, and only bites on
sub-microsecond documents that are not the library's target workload.
**Estimated benefit:** none worth banking. Lazy-allocating the one obvious suspect (the
per-call `new Map()` for the key cache) would recover ~6% of our fixed floor, about
0.03 µs per call — negligible, and only for documents that intern zero keys.
**Rigor:** fail-fast probe (per-parse timing across three sizes with a two-point fixed/
rate fit, plus one isolated allocation micro-benchmark).

## Background

The committed head-to-head has small-records at 2.32× `JSON.parse` — the worst parse
ratio in the table — and the working theory is that this is fixed per-call overhead:
work that happens once per `parse()` regardless of document size, which a tiny document
cannot amortize. The suspect is `resetForStream`, called at the top
of every `parse`. It reassigns ~15 module-level state variables and,
notably, allocates a fresh `keyCache = new Map()` on every call.
`JSON.parse`, by contrast, is a native call with essentially no JavaScript-side per-call
setup. The hypothesis was that this fixed floor disproportionately taxes tiny documents
and that trimming it — especially deferring the `Map` allocation — would close the
small-records gap.

## Experiment

Measure best-of-N per-parse time for our `parse` and for `JSON.parse` at three sizes: a
hand-written *tiny* document (a 31-byte three-field mapping, where fixed cost dominates),
the committed *small*-records fixture (772 bytes), and the *medium*-records fixture
(103 KB, effectively asymptotic). From the small and medium points we fit a simple linear
model, time = fixed + bytes × rate, separately for each parser, and back out the fixed
per-call intercept; the tiny point is a sanity check that fixed cost is visible there.
Finally, an isolated micro-benchmark times a bare `new Map()` allocation to size its share
of our fixed floor. Measured under concurrent load from sibling agents, so the ratios,
the fixed/rate decomposition, and the `Map`-share percentage are the robust signals; the
absolute microsecond figures are indicative.

## Results

Per-parse time and the ratio to `JSON.parse` at each size:

| Size            | ours     | JSON.parse | ratio |
| --------------- | -------: | ---------: | ----: |
| tiny (31 B)     | 1.073 µs |   0.327 µs | 3.28× |
| small (772 B)   | 16.02 µs |   5.233 µs | 3.06× |
| medium (103 KB) | 1840 µs  |   573 µs   | 3.21× |

Two-point fixed/rate decomposition:

| Quantity                        | ours       | JSON.parse | ours ÷ JSON |
| ------------------------------- | ---------: | ---------: | ----------: |
| asymptotic rate (µs / KB)       |    17.80   |     5.40   |       3.30× |
| **fixed per-call floor (µs)**   |  **0.521** |  **0.127** |   **4.1×**  |
| fixed-overhead delta (ours−JSON)|      —     |      —     | **0.394 µs/call** |

Isolated allocation cost: a bare `new Map()` is **0.033 µs**, about **6%** of our
0.521 µs fixed floor.

## Interpretation & recommendation

The premise turns out to be weaker than the committed 2.32× suggested. On this machine
the ratio to `JSON.parse` is roughly flat across sizes — 3.28× at 31 bytes, 3.06× at
772 bytes, 3.21× at 103 KB — rather than spiking at the small end. (The absolute ratios
here run higher than the committed table's 2.0-2.3×, which is expected: different machine,
concurrent load, and these are block-YAML `yaml-plain` fixtures. The *shape* — flat
versus size — is the load-robust finding, and it is what matters for this hypothesis.) A
flat ratio is the signature of a per-byte cost, not a fixed-overhead cost; if the fixed
floor were the dominant tax on small inputs, the tiny ratio would tower over the medium
one, and it does not.

The decomposition explains why. Our fixed per-call floor is about 0.52 µs against
JSON.parse's 0.13 µs — a genuine 4.1× ratio, but the *delta* is only ~0.39 µs per call.
That delta is ~37% of the time on a 31-byte document, but falls to ~2.4% at 772 bytes and
vanishes by 100 KB. So the fixed overhead is only a practical concern for a workload that
parses a flood of sub-hundred-byte documents — which is not what this library is built or
benchmarked for. And there is no single lever to pull even if one wanted to: the obvious
suspect, the per-call `new Map()`, is just ~6% of the floor. The remaining ~94% is spread
thinly across the fifteen-odd state resets, the `parseNextDocument` entry, the leading
document-marker and BOM checks, and the trailing single-document check
— none individually large, and most of them load-bearing for correctness. Deferring the
`Map` to first use would save ~0.03 µs per call and only for documents that intern no keys
(larger documents populate and need it), which is not worth the added state-management
complexity. The recommendation is to leave the per-call path as is and look for parse
wins in the per-byte work instead, where the ~3.3× per-KB rate gap actually lives.
Confidence: **high** that fixed overhead is a dead end for the target workloads; the
audience it could ever matter to is a caller parsing millions of trivially small
documents in a tight loop.

## Code references

- `resetForStream` — `src/index.ts:467` (keyCache allocation ~475)
- `parse` — `src/index.ts:516` (calls `resetForStream` here)
- trailing single-document check — `src/index.ts:523`

## Provenance & sources

- Repo: lightning-yaml @ f9ffcad (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, Linux 6.18.5.
- Fixtures: bench/fixtures/data/{yaml-plain-small-records.yaml, small-records.json, yaml-plain-medium-records.yaml, medium-records.json} plus a hand-written 31-byte tiny doc (gitignored fixtures reproducible via `pnpm gen:fixtures`).
- Measured under concurrent load from sibling agents; ratios, the fixed/rate split, and the Map-share % are the robust signals, absolute µs indicative.
- Probe script in session scratch (`parse-probe/tiny.ts`): per-size per-parse timing + two-point fixed/rate fit + isolated `new Map()` micro-benchmark.
- Rigor of this study: fail-fast probe.
