---
title: "Parsing multiline block scalars: first baseline, and a faster accumulator"
optimization:
  name: "Block-scalar ConsString accumulator (parse)"
  conclusion: "Accumulating block-scalar text with a ConsString (`res +=`) instead of `parts.push`/`join` targets the function owning ~47% of self-time on multiline records, for an estimated high-single-digit to ~15% parse-CPU cut on block-scalar-heavy YAML."
  verdict: promising
---
**Verdict: Worth pursuing** (a deeper follow-up on the accumulator) — this paper's main
job is to establish the never-before-measured baseline for the owner's stated common
case, and in doing so it surfaces one concrete, low-risk lever.
**Estimated benefit:** the baseline finding is that multiline/block-scalar records parse
at **~3.0-3.2× built-in `JSON.parse`** — meaningfully slower than the ~2× we hit on flat
records. The lever (swap `parts.push(...)` + `parts.join("")` for `res +=` ConsString
accumulation in `parseBlockScalar`) targets the single function that owns ~47% of
self-time on this shape; a realistic estimate is **high-single-digit to ~15% less parse
CPU on block-scalar-heavy YAML**, medium confidence, pending an in-parser A/B.
**Rigor:** fail-fast probe (throughput baseline, one CPU profile, one isolated
accumulation-pattern micro-benchmark).

## Background

No committed fixture exercises `|` / `>` block scalars or embedded newlines, so the
performance of multiline strings — which the owner names as the common real-world case
(JSON-shaped YAML whose string fields are multi-line prose) — was entirely unmeasured.
The relevant code is `parseBlockScalar`. Its body loop walks the scalar one line at a
time: consume the mandatory content indent, find the line end with
`src.indexOf("\n", p)`, take one `src.slice(p, textEnd)` per line, and push the pieces
(text plus fold/break separators) into a `parts: string[]` array, which is finally
collapsed with `parts.join("")`. The hypothesis going in was that this per-line
`indexOf` + `slice` + array-push-then-join is heavier than the flat-record path, and
that the array/join accumulation in particular might be replaceable with the cheaper
`out += ...` ConsString pattern the dumper already uses.

## Experiment

A corpus generator builds records shaped like the existing fixtures — `id` (int),
`name`, `tags` (sequence) — plus one `description` field that is an 8-to-15-line block
scalar of lorem-style prose. The identical logical data is emitted three ways: our
`parse()` on a `|` literal block, our `parse()` on a `>` folded block, and
`JSON.parse()` on the equivalent JSON (the description as one `"\n"`-joined string).
Sizes are "medium" (300 records, ~215 KB) and "large" (3000 records, ~2.1 MB); each is
timed as the best of five trials over many warm repetitions. A parity check confirms the
literal result matches the JSON records, and a CPU profile (inspector `Profiler`, 50 µs
interval) attributes self-time on the large literal corpus. A separate micro-benchmark
isolates the accumulation pattern (many small line pieces + newline separators, 3000
blocks × 12 lines) and compares three strategies: the current `parts.push + join`, the
same with the per-line `"\n".repeat(1)` replaced by a hoisted `"\n"` constant, and
`res += ...` string concatenation.

All measurements were taken while sibling agents ran concurrently, so absolute ms are
indicative; the ratios to `JSON.parse`, the profile percentages, and the accumulator
ratios are the robust signals.

**Parity note.** The literal parse does not byte-for-byte deep-equal the JSON records,
and that is correct, not a bug: a `|` block with default (clip) chomping appends exactly
one trailing newline, which the `"\n"`-joined JSON string does not carry. Confirmed
directly — stripping the single trailing `\n` makes the two identical. The folded `>`
result differs further only by the expected newline-to-space folding.

## Results

Parse time and throughput, and the ratio to built-in `JSON.parse` on the same logical
data (lower ratio = closer to JSON; JSON runs at ~650-675 MB/s here):

| Corpus                  | JSON.parse | ours `\|` literal | ratio vs JSON | ours `>` folded | ratio vs JSON |
| ----------------------- | ---------: | ----------------: | ------------: | --------------: | ------------: |
| medium (300 rec, 215 KB)|   0.308 ms |          0.993 ms |     **3.23×** |        0.949 ms |         3.08× |
| large (3000 rec, 2.1 MB)|   3.186 ms |          9.568 ms |     **3.00×** |        9.227 ms |         2.90× |

For context, the project's flat-records baseline is ~2× JSON.parse; block scalars land
noticeably worse, around 3×. The YAML is only ~1.06× the JSON byte size, so indentation
bloat does not explain the gap — the work does.

CPU self-time on the large `|` literal corpus (top functions):

| Function              | self-time |
| --------------------- | --------: |
| `parseBlockScalar`    | **47.2%** |
| `parseBlockMap`       |     14.7% |
| `parseBlockNode`      |     13.6% |
| `advanceCountingBreaks`|     6.3% |
| everything else       |     ~18%  |

Accumulation-pattern micro-benchmark (3000 blocks × 12 lines), as a ratio to the current
`parts.push + join` (lower = faster):

| Strategy                         | ratio to push+join |
| -------------------------------- | -----------------: |
| `parts.push(...)` + `join("")` (current) | 1.00× (baseline) |
| push, but hoist `"\n"` constant  |              0.88× |
| `res += ...` (ConsString)        |          **0.18×** |

## Interpretation & recommendation

Two things come out of this. First, the coverage finding: the owner's common case is our
slowest records-shaped parse. Block scalars run at ~3× JSON.parse, about half again
slower than the ~2× we quote for flat records, and the reason is concentrated and
visible — `parseBlockScalar` alone is nearly half of all self-time on block-heavy data.
That is the number to track from here on; any future multiline optimization is measured
against these ~3.0-3.2× figures.

Second, the lever. The isolated micro-benchmark shows the accumulation strategy inside
`parseBlockScalar` is leaving a lot on the table: building the string with `res += ...`
is dramatically faster than the current array-push-then-join — a ~5.6× speedup on the
accumulation pattern alone. This is the well-understood V8 behaviour where `+=` builds a
ConsString (a rope: O(1) per append, flattened lazily on first read) while
`parts.push(...)` allocates and grows a backing array that `join` must then walk in full.
The dumper already relies on exactly this pattern (`out += ...`, flushed once), so
adopting it here is idiomatic for the codebase and low-risk. Independently, the per-line
`"\n".repeat(1)` on the literal path allocates a fresh one-character
string every line for the overwhelmingly common single-break case; replacing it with a
hoisted `"\n"` constant is a ~12% win on the accumulation on its own and is trivially
safe.

The honest caveat is that the 5.6× is the speedup of the *accumulation sub-part in
isolation*, not of the whole function. `parseBlockScalar`'s 47% also includes the
per-line indent scan, `indexOf`, and `slice`, which the change does not touch. So the
realistic whole-parse gain is a fraction of 5.6× — my estimate is high-single-digit to
~15% of parse CPU on block-scalar-heavy YAML, with medium confidence, and the honest way
to pin it down is a deeper follow-up that actually swaps the accumulator inside a scratch
copy of the parser and re-times end-to-end (this round's budget did not allow the full
in-parser A/B plus oracle-parity verification).

How to apply, for that follow-up: in `parseBlockScalar` replace the `parts: string[]`
array and its terminal `parts.join("")` with a single
`let core = ""` accumulated via `core += ...` at each existing `parts.push` site, and
special-case the single-newline separator to a `"\n"` constant instead of
`"\n".repeat(1)`. Risk is low: a deep ConsString on a very large single block scalar is
the only thing to watch, and the dumper already exercises that path at document scale.
Verify against the oracle on block-scalar inputs (chomping and folding edge cases are the
place a mechanical rewrite could slip). Audience: any YAML whose records carry multi-line
string fields — the owner's stated common case.

## Code references

- `parseBlockScalar` — `src/index.ts:3900` (body loop `3963-4051`: line-end scan `4007`,
  per-line slice `4011`, single-break repeat `4028`, join `4060`; full range cited for
  the follow-up rewrite `3958-4064`)
- dumper `out +=` accumulator — `src/index.ts:4380`

## Provenance & sources

- Repo: lightning-yaml @ f9ffcad (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, Linux 6.18.5.
- Fixtures: constructed ad-hoc in session scratch (no committed multiline fixture exists); generator + JSON baseline are self-contained in the probe script.
- Measured under concurrent load from sibling agents; ratios to JSON, profile-%, and accumulator ratios are the robust signals, absolute ms indicative.
- Probe scripts in session scratch (`parse-probe/multi.ts`, `parse-probe/multi2.ts`): throughput baseline + CPU profile + accumulation A/B, plus a parity confirmation of the clip-chomp trailing newline.
- Rigor of this study: fail-fast probe.
