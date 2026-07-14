# Shape-specialized codegen: the ceiling for a compiled `stringify`

**Verdict: Reference / ceiling** — an informational upper bound, not a change to make now.
A dumper compiled to a specific record shape (the `fast-json-stringify` approach) reaches
about 2.2–2.4× `JSON.stringify` while staying byte-identical, roughly half the current
dumper's cost — but the honest floor is 2×, not lower, and reaching it is a large, higher-
risk build.

**Estimated benefit:** as a ceiling, ~2.2–2.4× `JSON.stringify` on **record-shaped
data** (about −47% to −49% versus the current dumper), i.e. roughly twice the headroom of
the shipped `combo`. This is CPU only; it is future work, not a now-change, and the cheap
20–30% is better captured first by the key-quote cache and single-pass write. It is also
**Node-backend-only**: the `new Function` it depends on is blocked by browser
Content-Security-Policy without `'unsafe-eval'`, so it cannot run for most of the library's
browser audience (see the availability caveat below).

**Rigor:** thorough experiment for what it claims to be — a hand-written serializer
specialized to the `records` shape, verified byte-identical, timed GC-between. It measures
a ceiling, not a shippable optimization.

*Part of the round-2 stringify studies; see [`./00-overview.md`](./00-overview.md) for the
whole set. It shares the per-scalar quote-check floor with
[`./stringify-05-multiline-classifier.md`](./stringify-05-multiline-classifier.md); a
cheaper classifier lowers the residual floor described here.*

## Background

The question this paper answers is: if the dumper's entire per-node dispatch,
recursion, `Object.keys` allocation, and depth-guard overhead could be erased by compiling
a serializer specialized to a known data shape — the technique `fast-json-stringify` uses
for JSON — how fast could the dumper get *without cheating on correctness*? That last
clause is the whole point of the study, and it is where a naive ceiling goes wrong.

A shape-specialized serializer knows the record's keys ahead of time, so it can inline them
as plain **constants**, fix the structure and field order, and format numbers inline
instead of dispatching per node. What it cannot skip is the per-string quote check. A
string value can *look* like a number and therefore require quoting, and deciding that is
mandatory on every string. The fixture makes this concrete: the uuid `444e-796234` is
emitted single-quoted, because `tryNumberGeneric` reads it as the float `4.44e-796232` and
the dumper must quote it to prevent YAML round-tripping it back as a number. A ceiling that
skips this check is measuring the wrong program.

## Experiment

We hand-wrote a serializer specialized to the `records` shape — exactly what a runtime
shape-detector would emit — with the keys inlined as constants, structure and order fixed,
and numbers formatted inline, **but still calling the real `writeStringScalar` on every
string value** so the number-lookalike quoting stays correct. The output was verified
byte-identical to the current dumper. Timing used the shared GC-between harness with
medians of 40–400 samples, reported against `JSON.stringify`. Because the machine was
shared during the session, absolute milliseconds are indicative and the ratios are the
robust signal.

## Results

The faithful, byte-identical codegen ceiling versus the current dumper (`base`), as the
multiple of `JSON.stringify`:

| fixture | base × JSON | **codegen ceiling × JSON** | headroom vs base |
| --- | ---: | ---: | ---: |
| medium-records | 4.3 | **2.24** | −47% |
| large-records | 4.6 | **2.38** | −49% |
| xlarge-records | 8.4 | **4.44** | −47% |

An earlier version of this prototype reached **1.36×**, but it was **not** byte-identical:
it skipped the number-lookalike quote check — that is, it cheated on the single most
expensive mandatory step. Once the check is restored the honest ceiling settles at
~2.2–2.4× on the 1 MB-class fixtures (and ~4.4× at xlarge, where allocation still
dominates).

## Interpretation & recommendation

A compiled dumper could plausibly reach ~2.2–2.4× `JSON.stringify`, roughly half the
current cost, because specialization erases the entire per-node dispatch, recursion,
`Object.keys` allocation, and depth-guard machinery — everything that is structural rather
than essential to producing the bytes. What it cannot erase is the 2× residual floor, and
it is worth being explicit about why that floor exists. Two costs remain irreducible:
the mandatory per-string quote classification (the uuid case above — you cannot know a
string is safe without looking at it), and the simple fact that YAML output is larger than
the equivalent JSON, so there are more bytes to emit no matter how the emitter is
structured. Those two together set the honest ceiling near 2×, which is why the byte-
identical prototype lands at 2.2–2.4× and the earlier 1.36× figure should be read as an
artifact of skipping correctness rather than as a reachable target.

Recommendation: record this as the ceiling and do not build it now. It is high effort —
runtime shape detection, `new Function` codegen, a compiled-serializer cache with a
fallback for unrecognized shapes, and the safety burden of generated code — and it is only
worth undertaking if the dumper becomes a headline metric for the project. The cheap
~20–30% is available first and at far lower risk from the key-quote cache
([`./stringify-01-key-quote-cache.md`](./stringify-01-key-quote-cache.md)) and the
single-pass write
([`./stringify-02-single-pass-restart.md`](./stringify-02-single-pass-restart.md)); this
codegen route would roughly double that headroom but should follow, not precede, those.
Reducing the per-string classification cost via the one-scan classifier
([`./stringify-05-multiline-classifier.md`](./stringify-05-multiline-classifier.md)) is the
one change that would lower the residual floor this ceiling bottoms out on.

### Availability caveat: `new Function` and browser CSP

There is a further limit that applies before any of the performance argument: this technique
depends on `new Function` (or `eval`) to compile the specialized serializer at runtime, and that
is blocked by a browser **Content-Security-Policy** whose `script-src` does not include
`'unsafe-eval'` — an increasingly common hardening default for web applications. So a compiled
dumper can run only on **Node backends**, or on sites that have explicitly opted into
`unsafe-eval`; for the majority of the library's in-browser use it simply cannot execute. That
reinforces the recommendation above: codegen is a **future, Node-backend-only** consideration, not
low-hanging fruit, whereas the key-quote cache and single-pass write use no code generation and
are portable everywhere the library runs. This availability limit is separate from the *safety* of
generated code — even where `new Function` is permitted, map keys are untrusted input and must be
passed to the compiled function as data, never interpolated into its source.

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off
  main), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition→Sparkplug→Maglev→TurboFan), pnpm 10.33.0,
  build target ES2022 (tsup 8.5.1). Machine: Intel(R) Xeon(R) @ 2.80GHz, Linux 6.18.5.
  All ms/ratios are from this machine.
- Bench: bespoke node scripts (mitata not used here); GC between every sample; medians of
  40–400 samples. The serializer was hand-written to the `records` shape and verified
  byte-identical; the earlier non-byte-identical 1.36× variant is reported only to
  document why the honest ceiling is higher.
- Fixtures: bench/fixtures/data/ (gitignored, reproducible via `pnpm gen:fixtures`).
- Ratios are the durable signal; absolute ms are machine-specific.
- Rigor of this study: thorough experiment (byte-identical); it establishes a ceiling, not
  a shippable change.
