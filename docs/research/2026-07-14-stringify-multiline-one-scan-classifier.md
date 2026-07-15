# A one-scan PLAIN/SINGLE/DOUBLE scalar classifier for `stringify`

**Verdict: Inconclusive**, leaning toward worth pursuing for string-heavy data — the
dumper scans every quoted string up to three separate times, and folding those into a
single pass is ~1.8× faster in isolation; but the end-to-end payoff was measured only
through the `combo`, not through a dedicated prototype, so the whole-dump number is not yet
settled.

**Estimated benefit:** material stringify **CPU** for **string-heavy and multiline
data** — the multiline weak spot runs at 7× `JSON.stringify`, worse than the 4.5× of
numeric records — and only low single digits for numeric record data. Isolated classifier
throughput improves ~1.8×; the confirmed whole-dump improvement so far is modest. No
memory effect.

**Rigor:** mixed — a thorough isolation microbenchmark of the classifier plus baseline
measurement of the previously-unmeasured multiline case, but **no end-to-end prototype**
wiring the one-scan classifier into the live dumper. That is the missing step.

whole set. It shares the "per-scalar work is the residual floor" theme with the codegen
ceiling in
[`./2026-07-14-stringify-codegen-speed-ceiling.md`](./2026-07-14-stringify-codegen-speed-ceiling.md), and
should be done before or alongside any codegen work.*

## Background

How the dumper renders a string that contains a newline is worth stating plainly, because
it was previously unmeasured and is easy to assume wrong. The dumper emits such a string
as a **double-quoted scalar with an escaped `\n`**, *not* as a block scalar (`|`):

```
description: "amet sed ipsum lorem do dolor\ndo adipiscing ipsum sed\n\neiusmod dolor do elit"
```

That is the same escaping shape `JSON.stringify` produces, and it is already correct — so
the opportunity here is not a change of output format, it is the cost of deciding on and
producing that format.

That decision is expensive because each quoted string is scanned up to **three** times.
First `isPlainScalarSafe` scans the string and fails at the newline. Then
`needsDoubleQuoting` scans it again to decide single versus double quoting. Then
`encodeDoubleQuoted` scans it a third time while building a `parts` array and joining it.
For a payload where most values are strings, that triple scan is paid on nearly every
value, which is why the multiline case turned out to be the dumper's real hidden weak
spot.

## Experiment

Two pieces. First, we measured the previously-unmeasured multiline baseline on a
constructed corpus of 4,000 records each carrying a three-line `description` field, and a
matched plain-string corpus for contrast, timing both against `JSON.stringify` with the
shared GC-between harness (medians of 40–400 samples). Second, we microbenchmarked a
**one-scan classifier** in isolation: a single pass over the string that returns an enum —
PLAIN, SINGLE, or DOUBLE — merging the work currently split across `isPlainScalarSafe` and
`needsDoubleQuoting`. Because the machine was shared during the session, absolute
milliseconds are indicative and ratios are the robust signal.

What we did **not** do is build a full prototype dumper using the one-scan classifier end
to end and verify it byte-identical, which is why the verdict is inconclusive rather than
worth-pursuing outright. The `combo` column below is the key-quote cache plus single-pass
change from the sibling papers, not the classifier; it is included to show the multiline
baseline and how much of it those two other levers already recover.

## Results

Baseline and `combo` on the constructed corpora, as the multiple of `JSON.stringify`:

| corpus | base × JSON | combo × JSON |
| --- | ---: | ---: |
| multiline-records | **7.05** | 6.32 |
| plain-string-records | 4.97 | 4.11 |

Multiline is a genuine weak spot at **7.05×**, materially worse than numeric records
(around 4.5×), precisely because of the triple scan described above. The one-scan
classifier, measured in isolation, is **~1.8× faster** than the current full classify on
plain strings — throughput rises from 9.7M to 17.7M strings/second — and faster still on
multiline strings, where it skips a redundant control-character scan entirely.

## Interpretation & recommendation

The theory and the isolation numbers agree that the current classifier does redundant
work: three passes where one, returning an enum, would carry all the information the writer
needs. On string-heavy data that redundancy is paid on nearly every value, which is why
the multiline corpus sits at 7× rather than the ~4.5× of numeric records, and why the
isolated classifier's 1.8× throughput gain is the right lever to aim at that gap. The
correct fix is the one-scan classifier, **not** switching multiline output to block
scalars — the escaped-`\n` double-quoted output is already correct and JSON-shaped, so
there is no format change to make, only a cost to remove.

The reason this is inconclusive rather than a firm recommendation is that the 1.8× is an
isolation figure. The whole-dump benefit depends on what fraction of dump time the classify
step actually is for a given payload, and that was not measured with a dedicated
end-to-end prototype. A deeper test would fold `isPlainScalarSafe` + `needsDoubleQuoting`
into a single scan behind the live dumper, verify byte-identity across the fixtures and
`pnpm test:stringify`, and measure the multiline and plain-string corpora through the real
writer.

Recommendation: **medium confidence** that it is worth doing for string-heavy and
multiline data; low expected benefit for numeric records. Do it before or together with
any shape-codegen work
([`./2026-07-14-stringify-codegen-speed-ceiling.md`](./2026-07-14-stringify-codegen-speed-ceiling.md)),
because both bottom out on the same mandatory per-string classification and a cheaper
classifier lowers that shared floor.

How to apply, in `src/index.ts`:

- Fold `isPlainScalarSafe` and `needsDoubleQuoting` into a single scan that returns an enum
  `{ PLAIN, SINGLE, DOUBLE }`; have `writeStringScalar` switch on that
  enum. This removes one redundant full string scan for every quoted value.
- The risk is that it must preserve the exact `looksLikeTypedScalar` / `tryNumberGeneric`
  semantics — the rules for when a string would be misread as a typed scalar and therefore
  needs quoting are subtle and easy to get slightly wrong. Gate the change on byte-identity
  across the fixtures and `pnpm test:stringify`.

## Code references

- `writeStringScalar` — `src/index.ts:4626` (approx.)

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off
  main), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan), pnpm 10.33.0,
  build target ES2022 (tsup 8.5.1). Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
  All ms/ratios are from this machine.
- Bench: bespoke node scripts (mitata not used here); GC between every sample; medians of
  40–400 samples. The multiline and plain-string corpora were constructed for this study
  (4,000 records with a three-line `description`); the one-scan classifier was measured in
  isolation, not yet wired into a full dumper prototype.
- Fixtures: bench/fixtures/data/ plus the constructed multiline corpus (gitignored,
  reproducible via `pnpm gen:fixtures` and the study's proto scripts).
- Ratios are the durable signal; absolute ms are machine-specific.
- Rigor of this study: mixed — thorough on the isolation microbenchmark and the multiline
  baseline; inconclusive overall because the end-to-end prototype is not yet built.
