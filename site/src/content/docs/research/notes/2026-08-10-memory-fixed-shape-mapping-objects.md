---
title: "Building mapping objects with a fixed shape: how much memory does it actually save?"
description: "A shape sweep of fixed-shape mapping construction: a modest win on regular records, a very large one on wide (20+ key) maps for an unrelated reason, and a 4.5x regression plus a key-order bug on optional-field documents"
optimization:
  name: "Fixed-shape mapping-object construction (parse)"
  conclusion: "Constructing mapping objects with a known key set saves only ~7% of a real parsed tree on regular records and regresses badly on optional-field documents; the durable finding is that maps with 20 or more keys fall into V8 dictionary mode today and cost roughly 7x what they should."
  verdict: situational
---
**Verdict: Worth pursuing, with a real tradeoff.** Handing the parser the key set
up front so it can build each mapping object with one fixed shape does save
memory — but only on documents whose records are regular, and far less of the
whole parsed tree than a single-fixture measurement suggested. On documents with
optional (sometimes-absent) keys it is both slower on memory and, as prototyped,
*wrong*.

**Estimated benefit:** on regular records of 19 keys or fewer, **−12% to −31% per
mapping object**, which dilutes to about **−7% of the whole retained tree** —
strings and arrays dominate a real document, so that ~7% is the number a user
would actually feel. On records with **20 or more keys** the saving jumps to
**−78% to −87% per object** and **−65% whole-document**, but for a different
reason than the hypothesis predicted (see below). On a document where ~40% of
declared keys are absent per record, retained heap goes **+349%**. This is a
**memory** axis result; the same prototype measured as **noise** on speed.

**The headline finding is not the hypothesis.** The wide-record win comes from V8
putting an object built by successive property stores into **dictionary (hash)
mode at exactly 20 properties** on the build measured here. Every mapping
lightning-yaml produces is built that way, so **any YAML mapping with 20 or more
keys is in dictionary mode today** and costs roughly 7× what a fast-property
object of the same size costs. That is a property of the shipped parser, needs no
schema, no hint, and no new public API to address, and is the item most worth
following up.

**Rigor:** thorough experiment on the sweep axes (multiple document shapes, fresh
processes per configuration, medians, run-to-run spread of exactly 0 on the
synthetic rows) — but run in a sandbox **without `node_modules`**, so fixtures
were regenerated from the repo's own seeded PRNG rather than by `pnpm
gen:fixtures`, and timings used `hrtime` loops rather than the mitata harness.
Treat the numbers as a strong directional result on regenerated fixtures, not as
a canonical fixture run.

## Background: this started as a question about schemas

The investigation began as a test of a different idea — could a user-supplied
[Zod](https://zod.dev) schema act as a *parse-time optimization hint* (never as a
validator, never changing the output)? That question resolved quickly and
negatively, and it is not this note's subject, so the short version:

- A CPU profile of a parse over an 875 KB block-YAML record fixture put **61.6%**
  of self time in scanning — finding token boundaries, counting line breaks,
  checking indentation. No schema can inform any of that.
- The things a schema does know map onto small slices: property assignment 4.96%,
  key extraction 4.88% (already served at a ~100% hit rate by the existing
  fast-key-match and key-cache machinery), and scalar type resolution 18.93% —
  the last of which is off-limits, because skipping it is what turns `port: 8080`
  into `"8080"`, i.e. validation rather than a hint.
- An end-to-end prototype of the best admissible lever came in at **0.99×
  baseline (median of 4 fresh processes, range 0.93–1.08×)** — inside run-to-run
  noise — even though the fast path fired on 99.98% of property stores.
- And the parser already holds the only thing that lever needs: the previous
  sibling mapping's key list, byte-validated against the source. Whatever shape a
  schema could declare, the parser learns for free from the first record.

One number from that spike did look interesting enough to chase on its own:
retained memory of **145.2 B/object** for the current construction versus
**97.3 B/object** for fixed-shape construction — a −33% saving on mapping
objects, measured on a single microbenchmark shape. Everything below is the
follow-up sweep that asked whether that −33% generalises. **It does not**, and
the way it fails is more interesting than the original number.

## Method

Two prototypes were compared throughout: today's parser (`parseBlockMap` building
a plain `{}` and filling it through the dynamic keyed store) and a scratch copy
whose mapping construction predicts the next map's key list per nesting depth,
allocates through a cached generated constructor for that key list, and stores
matched keys through generated per-slot setters. `src/` was not modified.

Memory was measured identically for both variants everywhere: force GC twice,
sample `process.memoryUsage().heapUsed`, build N objects into a live array, force
GC, sample again, report the delta over N. Payload values were allocated *before*
the first sample, so the delta reflects mapping-object cost rather than payload —
except in the deliberately pointer-heavy nested-values case, where both variants
allocate fresh children identically. Every synthetic row is the median of 3 fresh
processes; the spread was **exactly 0.0 B on every row**, so the noise floor sits
below the reported precision.

Four axes were swept: key count (3 to 200), value type, shape regularity
(identical records, ~10% carrying extra keys, reordered keys, ~40% of keys absent),
and document scale (100 to 500,000 objects). Whole-document retained heap was then
measured on four real parses. The dictionary-mode cutover was measured directly
with `%HasFastProperties` under `--allow-natives-syntax`.

**Sandbox limitation, stated plainly.** `node_modules` was absent, so
`pnpm gen:fixtures`, `pnpm test`, and the mitata benchmark harness could not run.
Fixtures were regenerated locally from the repo's own seeded PRNG and emitted by
our own `stringify` — the same record shapes as the committed datasets, but not
the committed bytes. A confirming run on real fixtures would need to check three
things: that the per-object and whole-document deltas hold on the canonical
fixture bytes, that output equivalence holds **including key order**, and that the
sparse-record regression reproduces.

## Results

### Key count decides everything; document size decides nothing

| keys | today B/obj | fixed-shape B/obj | delta | today in fast properties? |
|---|---|---|---|---|
| 3 | 64.1 | 56.1 | −12.5% | yes |
| 5 | 104.1 | 72.1 | −30.7% | yes |
| 8 | 128.1 | 96.2 | −25.0% | yes |
| 10 | 128.2 | 112.2 | −12.5% | yes |
| 20 | 864.1 | 192.2 | **−77.8%** | **no** |
| 50 | 3168.1 | 432.2 | **−86.4%** | **no** |
| 100 | 6240.1 | 832.3 | **−86.7%** | **no** |
| 200 | 12384.1 | 1632.5 | **−86.8%** | **no** |

Below the cutover the win is a sawtooth, not a curve — −12.5% at 3 keys, −30.7%
at 5, −12.5% again at 10 — because both allocators quantise to size buckets.
Quoting any single number from that band as "the" saving is exactly the mistake
the original −33% figure made.

Scale is not a variable of interest: the per-object figure converges by ~10,000
objects and holds to 500,000 (−24.9% at 10k, −25.0% at 100k and 500k).

The absolute saving is a near-constant **~32 B/object of header and
backing-store overhead**, independent of value type, so the *percentage* is pure
dilution arithmetic. With shared payloads (strings, small integers) it reads as
−25%; with records whose children are themselves freshly-allocated objects and
arrays it drops to **−4.8%**. Real documents look like the latter.

### On a whole parsed tree, the regular-record win is about 7%

| document | bytes | today retained | fixed-shape retained | delta |
|---|---|---|---|---|
| 4,132 × 8-key records + nested `meta` | 875,312 | 2,195,296 | 2,037,432 | **−7.2%** |
| 4,132 × 25-key records | 2,329,718 | 8,868,304 | 3,111,008 | **−64.9%** |
| 8-key records with anchors/aliases + `!!binary` | 574,454 | 1,759,768 | 1,640,656 | **−6.8%** |
| 10 optional keys, ~40% absent | 496,806 | 1,185,168 | 5,320,384 | **+348.9%** |

The honest figure for the realistic regular case is therefore **≈ −7%**, not
−33%: the per-object saving is real, and small next to the strings and arrays it
sits among. Anchor-and-alias-heavy data behaves like plain block YAML (−6.8% vs
−7.2%) — aliases simply mean fewer distinct mapping objects to save on.

### The largest effect: mappings of 20+ keys are in dictionary mode today

Measured with `%HasFastProperties` on Node 22.23.2 / V8 12.x:

```
keys:  3 5 8 10 12 14 16 17 18 19 | 20 24 32 64 100 128 200
{}  :  fast ...................... | slow slow slow slow slow slow slow
Row :  fast ................................................ fast
```

The transition is at exactly **20** properties for an object built from `{}` by
successive stores. The threshold is a V8 internal that can move between versions
and engines, so treat 20 as *measured on this build*. What is portable is the size
of the step: crossing it takes a mapping object from 128 B to 864 B, about **7×**.

Every mapping lightning-yaml produces is a `{}` filled by successive stores, so
**a YAML mapping with 20 or more keys is in dictionary mode today**. That is not
an exotic shape — a Kubernetes manifest's `metadata.labels`, a Docker Compose
service block, a large `env:` map, or almost any generated config crosses it
routinely:

```yaml
# 19 keys: compact fast-property object
# 20 keys: same data, ~7x the retained cost
env:
  VAR_01: a
  # ... 18 more ...
  VAR_20: t
```

This is worth noting against prior art rather than presented as brand-new: the
[V8 optimization guide note](/research/notes/2026-07-12-v8-optimization-guide/)
already anticipated that "genuinely huge" mappings would go dictionary mode, and
the [value-interning note](/research/notes/2026-07-14-memory-value-interning/)
ran the `%HasFastProperties` check that the
[other-parsers survey](/research/notes/2026-07-14-techniques-from-other-parsers/)
called for and found `true`. Both are consistent with this sweep — those checks
used medium records well under 20 keys. What is new here is the **measured
location of the cutover** and its **cost in whole-document terms**: −64.9% of
retained heap on a wide-record document.

### The failure mode: optional and absent keys

This is where the approach stops being a smaller win and becomes a loss.

| shape (8 keys) | today B/obj | fixed-shape B/obj | delta |
|---|---|---|---|
| every record identical | 128.1 | 96.2 | −25.0% |
| ~10% carry two extra keys | 128.2 | 100.1 | −21.9% |
| keys arrive in a different order than declared | 128.2 | 96.2 | −25.0% |
| **~40% of keys absent per record** | **88.8** | **96.2** | **+8.4%** |

Two compounding causes, both measured:

1. **Empty slots are still slots.** When keys are missing, today's construction
   gets *cheaper* — it only pays for what is present (88.8 B). A fixed-shape
   constructor allocates the full slot count regardless, each absent key holding
   `undefined`.
2. **The fixup destroys the shape it just bought.** The prototype deletes
   unfilled predicted slots when the mapping closes, and `delete` on a
   constructor-built object drops it straight into dictionary mode — measured
   directly: the deleted-from object reports fast properties `false` while the
   equivalent plain object reports `true`.

So an irregular document pays the constructor's fixed cost *and* the
dictionary-mode cost, while today's parser pays neither. Whole-document: 1.19 MB
today versus 5.32 MB, **+349%**, roughly 4.5× worse.

### Correctness: the prototype was not output-equivalent

The original single-fixture spike reported byte-identical output, and that was
true — of that one fixture. Re-run across four:

```
regular 8-key records   true
25-key records          true
anchors + !!binary      true
optional-field records  false   <- 3,418 of 4,132 records differ
```

Values were all correct; **key order was not**. Today's parser yields document
order (`{"uuid":…,"name":…,"tags":…}`); the prototype yields constructor-slot
order (`{"uuid":…,"created":…,"region":…,"name":…}`). Key order is observable
through `Object.keys`, `JSON.stringify`, and our own `stringify` round-trip, so
this is a silent wrong-answer bug rather than a cosmetic one — and YAML mappings
preserve the document's entry order
([§3.2.1.1](https://yaml.org/spec/1.2.2/#3211-nodes)) in the representation our
API hands back.

The lesson generalises past this prototype: **the single-fixture validation
passed only because the fixture never exposed the divergence.** Output-equivalence
checks for a construction change have to span shapes, and have to compare key
order, not just values.

## Interpretation and recommendation

Fixed-shape mapping construction is **situational**, and the situations are
sharply divided:

- **Regular records under 20 keys:** a genuine but modest win — about **−7% of
  the retained tree**. Not nothing, not worth a new public API, and not the −33%
  the first measurement suggested.
- **Records of 20 or more keys:** a very large win (**−65% whole-document**) that
  is really a *bug fix*, not an optimization. Today's parser is paying a
  dictionary-mode penalty on wide mappings.
- **Optional-field records:** a loss on memory (**+349%**) and, as prototyped,
  incorrect.

**The one thing worth following up is the dictionary-mode cutover, and it is
independent of the schema framing entirely.** It needs no schema, no hint object,
and no runtime code generation: the parser already knows the previous sibling
mapping's key list, which is enough to size a wide mapping's property storage up
front. Before any code change lands, a follow-up would have to measure, on the
canonical committed fixtures:

1. That the whole-document saving on wide mappings reproduces outside this
   sandbox, with the standard benchmark harness and `pnpm bench:self`.
2. **Output equivalence including key order**, across regular, wide, rich, and
   optional-field documents — the check this sweep showed a single fixture cannot
   deliver — with the yaml-test-suite pass rate unchanged.
3. That narrow and sparse mappings do not regress: any presizing scheme must
   leave a 3-key or a mostly-absent-key mapping no worse than it is today, since
   both are common and both are where this technique fails.
4. Whether the cutover exists at all on the other engines we benchmark. The
   threshold measured here is a V8 internal; a fix that helps V8 must at minimum
   not hurt JavaScriptCore or SpiderMonkey.

There is **no recommendation to expose a schema, a shape hint, or any new parse
option** — the measured speed effect was noise, and the memory effect that
survives scrutiny is reachable from information the parser already has.

## Code references

- Block mapping construction (`{}` allocation + fill loop) — `src/core.ts:3602`
- Flow mapping construction — `src/core.ts:1638`
- Dynamic keyed property store — `storeKey`, `src/core.ts:1711`
- Previous-sibling key list (fast key match) — `lastRecordKeys`, `src/core.ts:371`
- Key intern cache and its byte cap — `internKey` `src/core.ts:1926`, `keyCacheMaxBytes` `src/core.ts:318`
- Plain-scalar resolution and the numeric fast path — `resolvePlain` `src/core.ts:2178`, `tryNumber` `src/core.ts:2416`
- Block sequence accumulation — `parseBlockSeq`, `src/core.ts:3574`

## Related notes

- [V8 optimization guide](/research/notes/2026-07-12-v8-optimization-guide/) — anticipated dictionary mode for huge mappings; this note locates the threshold.
- [String value interning](/research/notes/2026-07-14-memory-value-interning/) — the `%HasFastProperties` check on medium records, consistent with this sweep.
- [Techniques from other parsers](/research/notes/2026-07-14-techniques-from-other-parsers/) — asked for exactly this dictionary-mode check as the one memory-relevant lead.
- [Columnar store + proxy facade](/research/notes/2026-07-14-memory-columnar-store-and-proxy-facade/) and [Object.freeze on parsed output](/research/notes/2026-07-14-memory-object-freeze-effects/) — the other two parse-memory studies; both are rejected, this one is not.
- [Real-world YAML optimization profile](/research/notes/2026-07-16-real-world-yaml-optimization-profile/) — the target workload the fixtures here imitate.

## Provenance & sources

- Repo: lightning-yaml @ `2412a7b`, branch `main`, 2026-08-10. `src/` was not modified; all prototypes lived in a scratch directory.
- Runtime: Node **v22.23.2** / V8 12.x (native TypeScript type-stripping, no build step). Linux sandbox container.
- **Sandbox limitation:** `node_modules` was absent, so `pnpm gen:fixtures`, `pnpm test`, and the mitata harness could not run. Fixtures were regenerated from the repo's own seeded PRNG (`bench/util/prng.ts`) and emitted by our own `stringify`, reproducing the committed datasets' record shapes but not their exact bytes; speed figures came from `hrtime` loops and memory figures from forced-GC `heapUsed` sampling under `--expose-gc`. These are **not** canonical fixture runs.
- Data: four regenerated documents — 4,132 × 8-key records with a nested 2-key map (875,312 B), 4,132 × 25-key records (2,329,718 B), anchor/alias + `!!binary` records (574,454 B), and 10-optional-key records with ~40% absent (496,806 B) — plus a synthetic sweep of 100,000-object arrays across key count, value type, shape regularity, and scale.
- Method: every synthetic configuration is the median of 3 fresh processes (spread exactly 0.0 B); the end-to-end speed figure is the median of 4 fresh processes, 11 alternating blocks of 40 parses each. Dictionary-mode state read via `%HasFastProperties` under `--allow-natives-syntax`.
- Measured under concurrent agent load: ratios and heap deltas are the durable signals; absolute milliseconds are machine-specific.
- Rigor of this study: thorough experiment on the shape axes, subject to the sandbox-fixture limitation above.
