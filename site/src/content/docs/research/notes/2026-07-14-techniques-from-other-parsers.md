---
title: "Runtime shape-codegen and record-structure techniques from binary and schema serializers"
---

## Abstract

**Verdict, per axis:**

- **Stringify — Worth pursuing**, but only for one audience: large, homogeneous arrays or
  streams of same-shape records. That is our worst stringify case today (xlarge-records at
  8.05× `JSON.stringify`). Per-shape serializer specialization is well corroborated in the
  prior art. For small or heterogeneous data it is **Not worth pursuing** — the setup cost
  dominates and there is nothing to amortize it over.
- **Parse — Inconclusive.** msgpackr's object-literal decode codegen is a genuine ~3.3×
  lever *for its own binary format*, and it maps onto a gate we already have
  (`FastKeyMatch`), but for us it is a speculative lead rather than a measured win. It merits
  a scratch prototype after the stringify work, not before.
- **Memory — Not worth pursuing.** None of these techniques shrink the *retained* object;
  they change how fast and with how much transient churn it is built, not how big it is once
  held. The single exception is one cheap diagnostic: check whether our parsed objects are in
  V8 dictionary (hash) mode, because if they are, literal construction could reduce retained
  heap as a side effect.
- **Zero-copy / lazy field access (FlatBuffers, simdjson On-Demand) — Not worth pursuing.**
  These collide with our plain-`{}` output mandate and with the lazy-facade design we already
  rejected.

**Estimated benefit:** stringify **CPU** on large homogeneous record collections — plausibly
moving that shape from roughly 8× `JSON.stringify` toward the 3–5× range by deleting
per-record key bookkeeping. This is closing the gap to native, not beating it. No memory
benefit except the diagnostic above; effectively **none** on small or shape-churning inputs.

**Rigor:** this is a **literature survey**, not an experiment. Every performance figure below
is a third-party published claim taken from each library's own README, benchmark file, or
author blog, with the exact package **version cited**. Treat the numbers as claims, not as
independently reproduced facts — no local benchmarks were run for this document (that would
have perturbed the measurement agents running concurrently).

Cross-references: the getter/Proxy facade this survey must respect is rejected in
[`../2026-07-12-design-c-hybrid-parser.md`](2026-07-12-design-c-hybrid-parser.md) §5; the plain-`{}` mandate is
[`../2026-07-12-v8-optimization-guide.md`](2026-07-12-v8-optimization-guide.md) §6; the "allocation is the
whole game" finding is [`../2026-07-12-design-a-pure-js-parser.md`](2026-07-12-design-a-pure-js-parser.md) §2; and the
"construction-path overhead is unreachable from JS (≈1.62× RSS floor)" refutation is
[`../2026-07-12-adversarial-verdicts.md`](2026-07-12-adversarial-verdicts.md).

---

## Background

lightning-yaml has two weak axes relative to built-in `JSON`. Stringify runs **4–8× slower
than `JSON.stringify`**, with xlarge-records the worst at **8.05×**. Retained heap on parse
is **2.3–2.7× that of `JSON.parse`**. Earlier dossier work surveyed *text* parsers — JSON
scanners such as simdjson and json-custom-numbers, CSV parsers such as uDSV and PapaParse, and
JS-source parsers — and concluded that our bottleneck is **value materialization and object
construction, not scanning**.

That earlier work never surveyed the one software family whose entire reason for existing is
fast object (de)serialization: **binary and schema formats, and compiled serializers**. Their
central techniques — runtime shape codegen, shared record structures, per-shape constructors —
are aimed squarely at construction cost, which is exactly our problem. This survey fills that
gap.

The hypothesis is that lightning-yaml is one step away from what these libraries need. They
require a schema; we already **detect repeating record shapes at runtime**. On the parse side
we have `FastKeyMatch`, `lastRecordKeys`, and `publishRecordKeys`; on the dump side the
`dumpScanRefs` ref-count pass already walks every object. So we could synthesize a per-shape
"schema" at runtime and specialize on it, without ever asking the user for one. For each
library the survey asks three questions: (a) what is the concrete, transferable technique; (b)
does it survive our hard constraints; and (c) how applicable is it, and to which direction —
stringify, parse, or memory.

Our hard constraints, which every candidate technique is judged against:

- **Plain `{}` objects and real arrays only.** This is the API-parity mandate (the V8 optimization guide, §6). The
  lazy getter/Proxy facade is already rejected (the hybrid-design study, §5) because it breaks `Object.keys`,
  spread, and `deepEqual`, damages consumer inline caches, and pins the source string via
  SlicedString. Any idea from a *zero-copy* format (FlatBuffers, simdjson On-Demand) inherits
  that rejection.
- **No schema and no build step over user data.** That rules out ahead-of-time (AOT) codegen
  of the typia kind. Only **runtime `new Function`** is available to us, and its one-time
  compile cost is real and must be amortized.
- **Keys are untrusted input.** Unlike fast-json-stringify, avsc, and protobuf.js — where the
  schema is trusted, developer-authored source — any codegen we perform consumes
  attacker-influenced key strings. This is a first-class security constraint, revisited under
  *Risks* below.
- **"Faster" means closing the gap to `JSON.stringify`, not beating it.** We start 4–8×
  slower, so a technique that is "slower than native but much faster than us" is still a clear
  win.

---

## Method

Web-only. Primary sources were fetched directly: READMEs, benchmark files, author blog posts,
and each `package.json` for the exact version. No local runs, to avoid perturbing the
concurrent measurement agents. Every number is attributed to its source and version; the full
source list is in the provenance footer.

---

## Results, per library

### 1. msgpackr 2.0.4 (Kris Zyp) — record structures plus object-literal decode codegen

**Technique.** msgpackr distinguishes *maps* (arbitrary keys) from *records* (a fixed set of
fields). When many objects share a shape, it emits a **structure definition once** and
references it thereafter. The decode multiplier comes from what it does on encountering a
structure reference. In the author's own words:

> "When msgpackr/cbor-x encounters a reference to a record structure, rather than incrementally
> adding properties, it will actually generate code (and cache it) for constructing the object
> with object literal syntax."

> "An object literal specifies all the properties at once (they are all known from the record
> structure definition), and the property values are read directly into this object literal.
> V8 can compile an object literal in a way that the final target class can be immediately
> created and no transitions between hidden classes are needed."

> "V8 uses hidden classes, which means that it needs to change the class of the object for each
> property as it is added, which is a complicated procedure."

**Claimed numbers** (msgpackr's own `benchmark.md` harness): decode with shared structures
runs at **711,700 ops/sec versus `JSON.parse` at 216,600 — about 3.3×**. Without structures,
msgpackr decode is actually *slower* than `JSON.parse`, at 186,500. On the encode side:
**254,700 ops/sec with structures and 234,000 plain, versus `JSON.stringify` at 297,900** — so
msgpackr's encode is **not** faster than native JSON. The headline win is therefore a
**decode/parse** win, driven by the object-literal codegen; the record-structure idea itself
buys wire compactness on encode, not speed.

**Does it fit us?** Partially, and on the parse side. We already gate on "same keys, same
order" — `FastKeyMatch` bails the moment a sibling record's keys diverge — which is exactly the
precondition needed to safely construct `{a: v0, b: v1, c: v2}` in one shot. JavaScript
guarantees left-to-right evaluation of object-literal property values, so a generated
`build()` that reads each value in order preserves our interleaved scan. The output is a
genuine plain `{}` with no facade, so the mandate holds. The caveats: we must fall back the
instant a key is missing, extra, or reordered; and the `new Function` compile has to amortize
over many records of that shape.

**Applicability.** Parse **speed**: medium (high only for large homogeneous record arrays).
For the retained-heap memory gap it does **not** help — the finished object is identical
either way. This is a speed and transition-churn lever, not a size lever.

### 2. fast-json-stringify 7.0.1 (Fastify) — schema-compiled serializer (most relevant to stringify)

**Technique.** Given a JSON Schema, fast-json-stringify **generates a serializer function as a
source string and compiles it with the `Function` constructor** at init. The generated body is
a straight-line **concatenation of literal key-prefixes with escaped values** — of the shape
`'{"name":' + asString(o.name) + ',"age":' + o.age + '}'`. At run time it therefore does **no
per-property type checks, no key enumeration, and none of the circular-reference bookkeeping**
that native `JSON.stringify` must do, "since it already knows the shape of the data." An
illustrative reconstruction of the generated shape (from the documented mechanism, not a
verbatim dump):

```js
// generated once per schema/shape:
function stringify(o) {
  let j = '{"id":' + o.id            // number: emit raw
        + ',"name":' + asString(o.name)   // string: escape+quote
        + ',"active":' + (o.active ? 'true' : 'false')
  return j + '}'
}
```

**Claimed numbers** (README benchmark, Node 22.14.0, i7 at 4 GHz): short string **29.4M versus
12.1M ops/sec, about 2.4×**; objects **7.3M versus 4.6M, about 1.6×**; a plain **array at
7,183 versus 7,924 — slightly slower**; and a **large array at 208 versus 331 — clearly
slower, about 0.63×**. For `anyOf`/`oneOf` it falls back to **ajv** validation, which is slow;
for `additionalProperties: true` (free-form objects) it **falls back to `JSON.stringify`
entirely**.

**Honesty note — do not gloss over this.** The "2× faster" tagline holds *only for small,
fixed-shape payloads*. On large arrays and on schema-less or dynamic objects, fast-json-stringify
is at parity with, or **worse than**, native. That is the same amortization law that bites us:
the codegen win is the per-record *setup* it removes — key enumeration and type dispatch — so it
pays only when there are many same-shape records to dilute the per-call overhead, and it *loses*
when native's C++ bulk path (large arrays) already dominates. The crucial difference for us is
that **our baseline is not native — we are 8× slower**. Even fast-json-stringify's
"slower-than-native large array" path would, if it removed the equivalent per-record work from
*our* dumper, plausibly move us from 8× toward the 3–5× range. We will not *beat*
`JSON.stringify`; we can close the gap to it.

**Does it fit us?** This is the direct analog for the stringify direction. We have no schema,
but `dumpScanRefs` already visits every object and could record, per shape, the ordered key
list. The transferable core is to **bake the fixed per-shape structure — the literal
`\n<indent>key:` prefixes and block layout — into a reused artifact, so each record pays only
value-emission and never repeats the key work.**

**Applicability.** Stringify: **high** for large homogeneous records; **low** for small or
heterogeneous data, where compile and setup cost dominate. Feeds the stringify direction.

### 3. avsc 6.0.0-rc.1 (stable line 5.7.x, Matthieu Monsch / `mtth`) — per-record generated constructors

**Technique.** avsc compiles each Avro `RecordType` into a **generated JS constructor plus
read/write functions, built with `new Function`**. Concretely, `RecordType.prototype._createConstructor`
in `lib/types.js` assembles a source string like
`return function Name(v0, v1, …){ this.a = v0; … }` and compiles it. The result is one
monomorphic constructor per shape, giving fast, predictable construction. avsc also provides
`Type.forValue()`, which **infers a schema from a decoded value** — conceptually the same move
we would make from a detected record shape.

**Claimed numbers:** the README states avsc is "typically faster than JSON with much smaller
encodings." There is no single clean multiplier on the landing page; detailed figures live in
its wiki Benchmarks.

**Does it fit us? — with a sharp warning.** avsc is the clearest **cautionary** example of
runtime codegen driven by field names. A schema with a field literally named `case` makes it
emit `return function case(...)`, which throws a **`SyntaxError` at `new Function`** (issue
#291); the maintainers themselves note that a deliberately malformed schema could achieve
"code being executed … similar to SQL injection." For us this is not a corner case, because
**our keys are untrusted document input.** Any codegen we ship must treat keys as *data* —
bracketed string literals, or an array injected into scope — and never interpolate them as
identifiers or as unescaped source. Separately, avsc returns *class instances*, not plain
`{}`; a per-shape constructor, even with a null prototype, risks violating our plain-object
identity and `instanceof` parity. The generation *technique* transfers; the "return a typed
constructor" part does not.

**Applicability.** Parse: low-to-medium. The technique is sound, but the plain-`{}` mandate and
the injection surface both constrain it. Its main contribution to this survey is the
**security lesson** for any codegen route.

### 4. protobuf.js 8.7.1 — reflection codegen equals static codegen (the amortization proof)

**Technique.** protobuf.js offers two modes over hand-tuned reader/writer primitives:
**static** (`pbjs` emits AOT modules) and **reflection** (it builds type-specific encoders,
decoders, and verifiers **at runtime** via the tiny `@protobufjs/codegen` utility — assembling
a function body from string parts, compiling with `Function`, and injecting dependencies as
scope variables). It skips the implicit `verify` on the hot path and is, in the maintainers'
description, "quite a bit of V8-specific profiling."

**Claimed numbers** (README): **static and reflected are within noise of each other** — decode
at 6.11M (static) versus 6.09M (reflected), and encode at 3.18M versus 3.25M ops/sec. Overall
the library claims "up to an order of magnitude" faster than other JS protobuf implementations
on real-world data.

**Why it matters to us.** This is the **key evidence behind the stringify verdict**: runtime
`new Function` codegen reaches **AOT-class steady-state speed**. The generated code is not a
compromise; once warm, it runs like hand-written code. So the *only* economic question for us
is amortizing the one-time compile — which is precisely the "large homogeneous array"
condition. `@protobufjs/codegen` is also the **pattern to adopt** if we do codegen at all:
scope-injected helpers, with no interpolation of untrusted text.

**Applicability.** Feeds the stringify direction (and parse) as **infrastructure and
evidence**, not as a standalone technique.

### 5. FlatBuffers JS and simdjson On-Demand (brief) — zero-copy and lazy, largely excluded

**FlatBuffers JS** is true **zero-copy**: there is no parse or allocation step, and accessors
read fields **by vtable offset, on demand, straight from the buffer**. **simdjson On-Demand**
builds a SIMD **structural index** (the positions of `{`, `}`, `:`, `,`, and quotes) and then
**lazily** materializes values as you navigate. Both are lazy-access designs, and the lazy
facade is **already rejected** for us (the hybrid-design study, §5: it breaks `Object.keys`, spread, and
`deepEqual`, pins the source string, and wrecks consumer inline caches; the adversarial-verdicts study additionally
refuted the RSS win).

The one *non-lazy* idea worth a footnote, for the memory/parse direction, is a **structural
offset/index pre-scan** — simdjson's "tape." This would be a compact `Int32Array` of node
boundaries, built in one SIMD-like `indexOf` sweep and then materialized *eagerly* into plain
`{}`. That is an offset-table idea for a possible future experiment, not a facade. It is worth
a mention only: scanning is only about **8% of our budget** (the local-microbenchmarks study, finding #4), so a better
index cannot move the headline much.

### Contrast: typia — AOT, and why it is off-limits

typia claims **about 10× `JSON.stringify`**, but via **compile-time** codegen: a TypeScript
transformer emits the serializer at build time from static types. It needs both the types and a
build step over the *shape being serialized* — impossible for a runtime parser fed arbitrary
YAML. typia confirms that the ceiling of shape-specialization is high, but for us that ceiling
is reachable **only** through the runtime `new Function` route — which protobuf.js proves
reaches the same steady-state speed.

---

## Transferable techniques (ranked by applicability)

| # | Technique | Source (version) | Fits our constraints? | Direction | Applicability |
|---|-----------|------------------|-----------------------|-----------|---------------|
| 1 | **Per-shape "record template" cache** — precompute the literal `key:`+indent prefixes once per detected shape; then per record, loop over the cached prefixes and emit only values (no `Object.keys`, no key re-quote, no indent lookup). This captures the codegen *benefit* without `new Function`. | derived from fast-json-stringify 7.0.1 + msgpackr 2.0.4 | **Yes** — plain `{}` in, byte-identical out, shape already detected by `dumpScanRefs`; no compile, no injection surface | stringify | **HIGH** |
| 2 | **Runtime `new Function` per-shape serializer** — bake the fixed key literals and block layout into a compiled function; skip per-value type dispatch. | fast-json-stringify 7.0.1 (mechanism); protobuf.js 8.7.1 (proof it is not penalized) | **Partial** — needs many same-shape records to amortize the compile; keys MUST be passed as data, never interpolated | stringify | **MED** (HIGH only for large homogeneous record arrays — our 8.05× worst case) |
| 3 | **Object-literal decode codegen** — construct `{a:v0, b:v1, …}` in one shot, avoiding hidden-class transitions. | msgpackr 2.0.4 / cbor-x | **Partial** — feasible where keys are fixed-order (our `FastKeyMatch` already gates this); needs a clean divergence fallback | parse (speed) | **MED** |
| 4 | **Per-record generated constructor** (monomorphic construction). | avsc 6.0.0-rc.1 | **Partial** — but returns a *typed instance*, in tension with the plain-`{}` mandate; carries a strong **injection warning** | parse | **LOW–MED** |
| 5 | **Scope-injected codegen utility** (build a function from string parts + `Function` + injected deps, with no text interpolation). | `@protobufjs/codegen` (protobuf.js 8.7.1) | **Yes, as tooling** — the safe way to implement #2 or #3 if we adopt them | stringify / parse | **infra** |
| 6 | **AOT ≈ runtime codegen** (reflected is within noise of static). | protobuf.js 8.7.1 | N/A — this is *evidence* that underwrites the stringify verdict | supports stringify | **evidence** |
| 7 | **Structural offset/index pre-scan** (an eager tape materialized into plain `{}`). | simdjson On-Demand (concept) | Maybe, non-lazy variant only | memory / parse | **LOW** (scanning is ~8% of budget) |
| 8 | **Zero-copy lazy field access** (vtable offsets). | FlatBuffers | **No** — the lazy facade is already rejected (the hybrid-design study, §5) | — | **rejected** |

---

## Interpretation

**The win is per-record *setup* removal, not magic.** Every one of these libraries earns its
speed the same way: it decides once, per shape, everything that native code must otherwise
re-decide per value — which keys exist, their order, their emitted prefix, and (with a schema)
their type. fast-json-stringify bakes that into a function; msgpackr bakes it into a cached
object-literal builder; avsc bakes it into a constructor. lightning-yaml's dumper currently
*re-does* per record: `Object.keys(rec)`, a per-key indent-cache lookup, and
`isPlainScalarSafe`/quote checks on the key. On xlarge-records — thousands of identical shapes —
that repeated per-record bookkeeping is a plausible chunk of the 8.05× gap, and it is exactly
what a per-shape template removes.

**Amortization is the whole story, and it cuts both ways.** protobuf.js proves generated code
is not slower once warm; fast-json-stringify proves it *loses* when there is nothing to
amortize over — a single large array against native's bulk path, or a dynamic
`additionalProperties` shape. Translated to our situation: codegen helps **large homogeneous
record collections** and hurts **small (1 KB, single-record) and shape-churning** inputs. The
fixed per-call overhead we already see on small records (2.32× parse) is the same tax — we must
not pay a compile on top of it.

**Decode-codegen is a cleaner win than encode-codegen in the prior art.** msgpackr gets 3.3× on
decode from object-literal construction, but its own encode is *not* faster than
`JSON.stringify`. That hints the object-literal construction trick — our parse path — may be
higher-leverage per unit of risk than serializer codegen. The counterweight is that our parse
is already at about 2× and healthy, whereas stringify at 8× has far more gap to close. So the
allocation of effort is: stringify gets the primary effort (bigger gap), and parse gets the
object-literal idea as a secondary lead.

**Memory gets very little.** These techniques change *how fast*, and *with how much transient
churn*, an object is built — not *how big it is once retained*. Our retained-heap figure of
2.3–2.7× is a size problem. Object-literal construction only helps it in the specific case
where our objects are currently in V8 **dictionary (hash) mode** and literal construction would
instead keep them in **fast-property** mode. That is a concrete, cheap thing to check
(`%HasFastProperties(obj)` under `--allow-natives-syntax`) and is the single memory-relevant
lead from this survey.

## Recommendation

- **Stringify — Worth pursuing, scoped.** Per-shape specialization is proven
  (fast-json-stringify at 1.6–2.4× on objects and short strings), and runtime codegen is proven
  un-penalized (protobuf.js reflected ≈ static). Prototype it, but stage it: **template cache
  first (no `new Function`), codegen second**, and target **only large homogeneous record
  arrays** — our 8.05× worst case. Expect it to *close the gap* to `JSON.stringify`, not beat
  native. Confidence: **medium** on the mechanism; the exact fraction of the gap it recovers is
  unmeasured.
- **Parse — Inconclusive, secondary.** msgpackr's object-literal decode codegen is a real ~3.3×
  lever *for its format*; for us it is a speculative speed lead, gated by fixed-order keys
  (which we already detect) and by `new Function` amortization. Worth a scratch prototype after
  the stringify work. Confidence: **low**.
- **Memory — Not worth pursuing**, except the one `%HasFastProperties` dictionary-mode check,
  which is cheap and decisive.
- **Zero-copy / lazy (FlatBuffers, simdjson On-Demand) — Not worth pursuing.** It collides with
  the plain-`{}` mandate and the already-rejected facade.

## How to apply

**A1 — Dumper "record template" cache (do this first; stringify).** *Target:* `src/index.ts`,
`dumpScanRefs`, `writeCollectionBody`, `writeEntryValue`. When
`dumpScanRefs` sees a run of same-shape objects — it already ref-counts every object — attach to
that shape a cached array of **pre-rendered key prefixes**: the exact `\n<indent>key:` bytes,
with the key already quoted and escaped as needed, keyed by the ordered key list plus indent
depth. In the write pass, for a record whose shape matches, replace `Object.keys(rec)` and the
per-key indent/quote work with a tight indexed loop: `out += prefix[i]; writeValue(rec[keys[i]])`.
*Estimated gain:* on xlarge-records and large-records (homogeneous), plausibly shaving a
meaningful fraction of the 8.05× / 4.79× gap by deleting per-record key bookkeeping;
near-zero on small or heterogeneous data (guard so those keep the current path).
*Confidence:* **medium** — the mechanism is sound and matches fast-json-stringify's own source
of speed, but the exact fraction is unmeasured. *Risk:* low — there is no `new Function`, and
output must stay byte-identical (add a round-trip test against the current dumper on all
fixtures).

**A2 — `new Function` per-shape serializer (only if A1 leaves a gap; stringify).** *Target:* a
new codegen helper modeled on `@protobufjs/codegen` — scope-injected, with keys passed as a
**data array**, never interpolated as source. Compile one serializer per shape, cache it by
shape id, and **gate on a record-count threshold** so the compile amortizes (e.g. at least N
same-shape records seen). *Estimated gain:* the increment beyond A1 (removing per-value
dispatch). *Confidence:* **low-medium.** *Risk:* **medium** — compile-cost regressions on small
or churning inputs (mitigated by the threshold plus fallback), and the **security constraint is
non-negotiable** (see Risks). *Availability:* the `new Function` this depends on is blocked by
browser Content-Security-Policy without `'unsafe-eval'`, so A2 is **Node-backend-only** (or limited
to sites that opt into `unsafe-eval`) — it does not apply to most of the library's browser audience,
a further reason to treat it as future work behind A1, which uses no code generation.

**A3 — Object-literal decode codegen (secondary; parse).** *Target:* the block-map construction
path — `storeKey` and `parseBlockNode` — behind the existing `FastKeyMatch`
gate. When a sibling record matches the cached shape, build via a cached `{k0:…, k1:…}` builder
instead of incremental assignment. *Estimated gain:* a speculative parse speed-up on large
homogeneous arrays (msgpackr saw 3.3× for its format; ours would be far less, since we are
already at ~2× and scanning is shared). *Confidence:* **low.** *Risk:* medium (divergence
fallback complexity). Prototype in scratch before committing.

**A4 — Free memory check (memory).** Under `--allow-natives-syntax`, assert
`%HasFastProperties(obj)` on medium-records parse output. If it is **false** (dictionary mode),
then A3's literal construction likely *also* reduces retained heap, which would promote A3's
priority for the memory gap. If it is **true**, confirm that codegen is a pure speed play and
drop the memory angle. *Confidence:* high that the *check* is decisive; which way it resolves is
unknown.

## Risks (codegen-specific, must be respected)

- **Untrusted keys are not a trusted schema.** avsc's `case`-field `SyntaxError` (issue #291),
  and its maintainers' "SQL-injection-like" caution, are the direct warning: keys come from the
  document. Any codegen MUST pass keys and prefixes as **scope data** — arrays, bracketed string
  literals — and never splice key text into the function source as identifiers. A `__proto__` or
  `constructor` key must not alter generated control flow (we already guard `__proto__`
  — keep that).
- **Amortization tax.** Do not compile on small or heterogeneous inputs; gate on shape-repeat
  count. fast-json-stringify's large-array and dynamic-object regressions are the cautionary
  data.
- **Output identity.** Everything must still emit plain `{}` and real arrays, and byte-identical
  YAML; add round-trip equivalence tests against the current dumper across all fixtures, before
  and after.

---

## Code references

- `dumpScanRefs` — `src/index.ts:4399`
- `writeCollectionBody` — `src/index.ts:4732`
- `writeEntryValue` — `src/index.ts:4766`
- `storeKey` — `src/index.ts:1567` (also where the `__proto__` guard lives)
- `parseBlockNode` — `src/index.ts:2864`

---

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off main),
  2026-07-14.
- Runtime target context: Node 22.22.2 / V8 12.4, ES2022. No local benchmarks were run for this
  document — it is a web-only prior-art survey, run concurrently with the measurement agents.
- Rigor of this study: **literature survey**. Every performance figure below is a third-party
  claim from the cited library's own README, benchmark, or author blog, at the stated version.
  They are claims, not independently reproduced facts. Ratios — not absolute ops/sec — are the
  transferable part.
- Sources, fetched 2026-07-14:
  - **msgpackr 2.0.4** (Kris Zyp): README and `benchmark.md`, plus the author blog —
    <https://github.com/kriszyp/msgpackr> ·
    <https://raw.githubusercontent.com/kriszyp/msgpackr/master/benchmark.md> ·
    <https://kriszyp.medium.com/building-the-fastest-js-de-serializer-a413a2b4fb72> · version from
    <https://raw.githubusercontent.com/kriszyp/msgpackr/master/package.json>
  - **fast-json-stringify 7.0.1** (Fastify): <https://github.com/fastify/fast-json-stringify> ·
    <https://raw.githubusercontent.com/fastify/fast-json-stringify/main/README.md> (benchmark on
    Node 22.14.0)
  - **avsc 6.0.0-rc.1** (stable line 5.7.x): <https://github.com/mtth/avsc> · codegen and
    security evidence at <https://github.com/mtth/avsc/issues/291> · version from
    <https://raw.githubusercontent.com/mtth/avsc/master/package.json>
  - **protobuf.js 8.7.1**: <https://github.com/protobufjs/protobuf.js> · codegen utility
    `@protobufjs/codegen`
  - **typia** (AOT contrast): dev.to samchon, "10x faster JSON.stringify" (a compile-time
    transformer)
  - **FlatBuffers** and **simdjson On-Demand**: concept references (lazy / zero-copy) — noted,
    not adopted.
