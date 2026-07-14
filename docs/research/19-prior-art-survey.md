# 19-prior-art-survey: runtime shape-codegen & record-structure tricks from binary/schema serializers

```
Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742, off main), 2026-07-14.
Runtime target context: Node 22.22.2 / V8 12.4, ES2022. (No local benchmarks were run for this
doc — it is a WEB-ONLY prior-art survey per brief #5, run concurrently with the measurement agents.)
All performance figures below are THIRD-PARTY CLAIMS from each library's own README/benchmark, with
the library VERSION cited. Treat them as claims, not independently reproduced facts.
```

Cross-links: overview `docs/research/14-perf-round-2-overview.md`; stringify-codegen work
(direction #1); memory/representation work (direction #4); the getter/Proxy rejection this survey
must respect is `docs/research/09-design-c-hybrid.md` §5 and the plain-`{}` mandate is
`docs/research/12-v8-optimization-guide.md` §6; the "allocation is the whole game" and
"construction-path overhead is unreachable from JS (≈1.62× RSS floor)" findings are
`docs/research/07-design-a-pure-js.md` §2 and `docs/research/10-adversarial-verdicts.md`.

---

## Headline verdict

**Runtime shape-specialized codegen IS worth prototyping for our stringify path — but only for one
audience: large, homogeneous arrays/streams of same-shape records (our worst stringify case, xlarge-
records at 8.05× JSON.stringify). It is a net loss for small or heterogeneous data.** The prior art
gives three concrete, independently-corroborated facts:

1. **Per-shape serializer codegen wins on objects** — fast-json-stringify **7.0.1** claims **1.6× on
   objects and 2.4× on short strings vs `JSON.stringify`** by baking literal key-prefixes into a
   generated function and dropping per-value type dispatch. (But it is **slower than native on large
   arrays**, 208 vs 331 ops/sec — see honesty note below.)
2. **Runtime `new Function` codegen is not itself a penalty** — protobuf.js **8.7.1** shows its
   runtime-*reflected* codegen reaches essentially the *same* steady-state speed as its AOT/`pbjs`-
   *static* codegen (decode 6.09M vs 6.11M ops/sec; encode 3.25M vs 3.18M). Once compiled, generated
   code runs at hand-written speed; the *only* cost is the one-time compile, which must be amortized.
3. **The decode-side literal trick is the big multiplier** — msgpackr **2.0.4** claims **~3.3×
   JSON.parse on decode** (711.7k vs 216.6k ops/sec) purely from constructing each record with an
   **object-literal** in a cached generated function (no incremental property assignment → no
   hidden-class transitions). Notably msgpackr's *encode* is **not** faster than JSON.stringify.

The lowest-risk first step is **not** `new Function` at all: a **per-shape "record template" cache**
in the dumper (precompute the literal `key:`+indent prefix strings once per detected shape, reuse
across every record of that shape) captures most of the codegen benefit — killing per-record
`Object.keys()`, key re-quoting and indent-cache lookups — with **zero** compile cost, **no** code-
injection surface, and **no** fallback complexity. Escalate to true `new Function` per-shape
serializers only if profiling on xlarge-records shows the remaining per-value dispatch still dominates.

For the **memory** direction (#4, retained heap 2.3–2.7× JSON) this survey is mostly a **NAY**: none
of these tricks shrink the *retained* object — same fields either way. The one testable lead is that
msgpackr's object-literal construction keeps objects in V8 *fast-property* mode; if our medium-records
objects are silently in *dictionary* mode, literal construction could both speed parse and shrink
retained heap (low confidence — needs a `%HasFastProperties` check).

---

## Context & hypothesis

lightning-yaml's two weak axes are **stringify (4–8× JSON.stringify, xlarge-records the worst at
8.05×)** and **retained heap on parse (2.3–2.7× JSON)**. The dossier already surveyed *text* parsers
(JSON: simdjson/json-custom-numbers; CSV: uDSV/PapaParse; JS-source parsers) and concluded the
bottleneck is **value materialization / object construction, not scanning**. It did **not** survey the
family whose entire reason for existing is fast object (de)serialization: **binary/schema formats and
compiled serializers**. Their central tricks — *runtime shape codegen*, *shared/record structures*,
*per-shape constructors* — are exactly aimed at construction cost.

Hypothesis: because lightning-yaml already **detects repeating record shapes at runtime** (parse side:
`FastKeyMatch`/`lastRecordKeys`/`publishRecordKeys`; dump side: the `dumpScanRefs` ref-count pass
walks every object), it is one step away from the schema these libraries require — we can synthesize a
"schema" per shape *at runtime* and specialize on it, without asking the user for one. This survey
asks, per library: (a) what is the concrete transferable trick, (b) does it survive our hard
constraints — **plain-`{}` output, no schema up front, drop-in `JSON.parse`/`stringify` parity** — and
(c) High/Med/Low applicability and which direction it feeds.

## Assumptions

- Our output must remain **plain `{}` objects / real arrays** (API-parity mandate, doc 12 §6); the
  lazy getter/Proxy facade is already rejected (doc 09 §5) on broken `Object.keys`/spread/`deepEqual`,
  damaged consumer inline-caches, and SlicedString source-pinning. Any idea from a *zero-copy* format
  (FlatBuffers, simdjson On-Demand) inherits that rejection.
- We have **no schema and no build step** over user data — so **AOT** codegen (typia-style TS
  transformer) is out; only **runtime `new Function`** is available, and its compile cost is real.
- Keys in a YAML document are **untrusted input**. Unlike fast-json-stringify/avsc/protobuf (schema is
  trusted, developer-authored), any codegen we do consumes attacker-influenced key strings — a
  first-class security constraint (see Risks).
- "Faster" for us means **closing the gap to JSON.stringify**, not beating it. We start 4–8× *slower*;
  a technique that is merely "slower than native but much faster than us" is still a win.

## Method

Web-only. Primary sources fetched (READMEs, benchmark files, author blog posts, package.json for exact
versions). No local runs (would perturb the concurrent measurement agents). Every number is attributed
to its source + version. Sources listed under **Reproduce**.

---

## Results — per library

### 1. msgpackr 2.0.4 (Kris Zyp) — record structures + object-literal decode codegen

**Trick.** msgpackr distinguishes *maps* (arbitrary keys) from *records* (a fixed set of fields) and,
when many objects share a shape, emits a **structure definition once** and references it thereafter.
The decode multiplier comes from what it does on seeing a structure reference — quoting the author's
blog verbatim:

> "When msgpackr/cbor-x encounters a reference to a record structure, rather than incrementally adding
> properties, it will actually generate code (and cache it) for constructing the object with object
> literal syntax."

> "An object literal specifies all the properties at once (they are all known from the record
> structure definition), and the property values are read directly into this object literal. V8 can
> compile an object literal in a way that the final target class can be immediately created and no
> transitions between hidden classes are needed."

> "V8 uses hidden classes, which means that it needs to change the class of the object for each
> property as it is added, which is a complicated procedure."

**Claimed numbers (msgpackr benchmark.md, its own harness):** decode with shared structures
**711,700 ops/sec vs JSON.parse 216,600 (~3.3×)**; without structures msgpackr decode is *slower* than
JSON.parse (186,500). Encode: **254,700 (structures) / 234,000 (plain) vs JSON.stringify 297,900** —
i.e. **encode is NOT faster than native JSON**. So msgpackr's headline win is a **decode/parse** win,
driven by the object-literal codegen; the record-structure idea buys *wire compactness* on encode, not
speed.

**Fits us?** *Partially, on the parse side.* We already gate on "same keys, same order" (`FastKeyMatch`
bails when a sibling record's keys diverge) — exactly the precondition to safely construct
`{a: v0, b: v1, c: v2}` in one shot. JS guarantees left-to-right evaluation of object-literal
property values, so a generated `build()` that reads each value in order preserves our interleaved
scan. Output is a genuine plain `{}` — no facade — so the mandate holds. Caveats: must fall back the
instant a key is missing/extra/reordered; and `new Function` compile must amortize over many records
of that shape.

**Verdict:** parse-**speed** MED (High only for large homogeneous record arrays). For the retained-
heap memory gap: **does not help** — the finished object is identical; this is a speed/transition-
churn lever, not a size lever.

### 2. fast-json-stringify 7.0.1 (Fastify) — schema-compiled serializer (most relevant to stringify)

**Trick.** Given a JSON-Schema, it **generates a serializer function as a source string and compiles
it with the `Function` constructor** at init. The generated body is a straight-line
**concatenation of literal key-prefixes with escaped values** — `'{"name":' + asString(o.name) +
',"age":' + o.age + '}'` shape — so at run time it does **no per-property type checks, no key
enumeration, and no circular-ref bookkeeping** that native `JSON.stringify` must do, "since it already
knows the shape of the data." Illustrative generated shape (reconstructed from the documented
mechanism — not a verbatim dump):

```js
// generated once per schema/shape:
function stringify(o) {
  let j = '{"id":' + o.id            // number: emit raw
        + ',"name":' + asString(o.name)   // string: escape+quote
        + ',"active":' + (o.active ? 'true' : 'false')
  return j + '}'
}
```

**Claimed numbers (README benchmark, Node 22.14.0, i7 4GHz):** short string **29.4M vs 12.1M
(~2.4×)**; objects **7.3M vs 4.6M (~1.6×)**; **array 7,183 vs 7,924 — slightly SLOWER**; **large array
208 vs 331 — clearly SLOWER (~0.63×)**. For `anyOf`/`oneOf` it falls back to **ajv** validation
(slow); for `additionalProperties: true` (free-form objects) it **falls back to `JSON.stringify`**.

**Honesty note (do not gloss):** the "2× faster" tagline is real *only for small, fixed-shape
payloads*. On large arrays and on schema-less/dynamic objects fast-json-stringify is at parity or
**worse** than native. That is the same amortization law that bites us: the codegen win is the
per-record *setup* it removes (key enumeration + type dispatch), so it pays when there are many
same-shape records and the per-call overhead is diluted — and it *loses* when native's C++ bulk path
(large arrays) already dominates. **Crucially, our baseline is not native — we are 8× slower.** Even
fast-json-stringify's "slower-than-native large array" path would, if it removed the equivalent
per-record work from *our* dumper, plausibly move us from 8× toward the 3–5× range. We will not *beat*
JSON.stringify; we can close the gap.

**Fits us?** *This is the direct analog for direction #1.* We have no schema, but `dumpScanRefs`
already visits every object and could record, per shape, the ordered key list. The transferable core
is: **bake the fixed per-shape structure (literal `\n<indent>key:` prefixes, block layout) into a
reused artifact so each record pays only value-emission, not key work.**

**Verdict:** stringify **HIGH** for large homogeneous records; **LOW** for small/heterogeneous
(compile/setup cost dominates). Feeds direction #1.

### 3. avsc 6.0.0-rc.1 (stable 5.7.x, Matthieu Monsch / `mtth`) — per-record generated constructors

**Trick.** avsc compiles each Avro `RecordType` into a **generated JS constructor + read/write
functions built with `new Function`** (`RecordType.prototype._createConstructor` in `lib/types.js`
assembles a source string like `return function Name(v0,v1,…){ this.a=v0; … }` and compiles it). One
monomorphic constructor per shape ⇒ fast, predictable construction. It also has `Type.forValue()` /
schema **inference from a decoded value** — i.e. it can synthesize the schema at runtime from data,
which is conceptually what we'd do from a detected record shape.

**Claimed numbers:** README claims "typically faster than JSON with much smaller encodings" (no single
clean multiplier on the landing page; detailed figures live in its wiki Benchmarks).

**Fits us? — with a sharp warning.** avsc is the clearest **cautionary** example of runtime codegen
from field names: a schema with a field literally named `case` makes it emit
`return function case(...)` → **`SyntaxError` at `new Function`** (issue #291), and maintainers note a
deliberately-malformed schema could achieve **"code being executed … similar to SQL injection."** For
us that is not a corner case — **our keys are untrusted document input.** Any codegen we ship must
treat keys as *data* (bracketed string literals / a scope-injected array), never interpolate them as
identifiers or unescaped source. Also: avsc returns *class instances*, not plain `{}` — a per-shape
constructor (even with a null prototype) risks violating our plain-object identity/`instanceof`
parity. The generation *technique* transfers; the "return a typed constructor" part does not.

**Verdict:** parse LOW-MED (technique yes, but plain-`{}` mandate + injection surface constrain it).
Feeds parse; its main contribution here is the **security lesson** for any codegen route.

### 4. protobuf.js 8.7.1 — reflection codegen == static codegen (the amortization proof)

**Trick.** Two modes over hand-tuned reader/writer primitives: **static** (`pbjs` emits AOT modules)
and **reflection** (builds type-specific encoders/decoders/verifiers **at runtime** via the tiny
`@protobufjs/codegen` utility — assemble a function body from string parts, compile with `Function`,
inject dependencies as scope variables). It skips implicit `verify` on the hot path and is "quite a
bit of V8-specific profiling."

**Claimed numbers (README):** **static vs reflected are within noise** — decode 6.11M (static) vs
6.09M (reflected); encode 3.18M vs 3.25M ops/sec. Overall "up to an order of magnitude" faster than
other JS protobuf implementations on real-world data.

**Why it matters to us:** this is the **key evidence for the headline** — runtime `new Function`
codegen reaches **AOT-class steady-state speed**. The generated code is not a compromise; once warm it
runs like hand-written code. So the *only* economic question for us is amortizing the one-time compile
— which is precisely the "large homogeneous array" condition. `@protobufjs/codegen` is also the
**pattern to copy** if we do codegen: scope-injected helpers, no interpolation of untrusted text.

**Verdict:** feeds direction #1 (and parse) as **infrastructure + evidence**, not a standalone trick.

### 5. (brief) FlatBuffers JS & simdjson On-Demand — zero-copy / lazy, largely excluded

**FlatBuffers JS:** true **zero-copy** — no parse/alloc step; accessors read fields **by vtable offset
on demand** straight from the buffer. **simdjson On-Demand:** builds a SIMD **structural index**
(positions of `{`,`}`,`:`,`,`,quotes) then **lazily** materializes values as you navigate. Both are
*lazy-access* designs. The lazy facade is **already rejected** for us (doc 09 §5: breaks
`Object.keys`/spread/`deepEqual`, pins the source string, wrecks consumer inline-caches; plus doc 10
refuted the RSS win). The one *non-lazy* idea worth a footnote for direction #4: a **structural
offset/index pre-scan** (simdjson's tape) — a compact `Int32Array` of node boundaries built in one
SIMD-ish `indexOf` sweep, materialized eagerly into plain `{}`. That is an *offset-table* idea for a
future E2 experiment, not a facade. Mention only — do not deep-dive; scanning is only ~8% of budget
(doc 06 #4), so a better index cannot move the headline much.

### (contrast) typia — AOT, and why it's off-limits

typia claims **~10× JSON.stringify** but via **compile-time** codegen (a TypeScript transformer emits
the serializer at build time from static types). It needs types + a build step over the *shape being
serialized* — impossible for a runtime parser fed arbitrary YAML. It confirms the ceiling of shape-
specialization is high, but reachable for us **only** through the runtime `new Function` route
(protobuf.js proves that route reaches the same speed).

---

## Steal-worthy techniques (ranked by applicability)

| # | Technique | Source (version) | Fits our constraints? | Direction | Applicability |
|---|-----------|------------------|-----------------------|-----------|---------------|
| 1 | **Per-shape "record template" cache** — precompute literal `key:`+indent prefixes once per detected shape; per record, loop cached prefixes + emit only values (no `Object.keys`, no key re-quote, no indent lookup). The codegen *benefit* without `new Function`. | derived from fast-json-stringify 7.0.1 + msgpackr 2.0.4 | **Yes** — plain `{}` in, byte-identical out, shape already detected by `dumpScanRefs`; no compile, no injection surface | #1 stringify | **HIGH** |
| 2 | **Runtime `new Function` per-shape serializer** — bake fixed key literals + block layout into a compiled fn; skip per-value type dispatch | fast-json-stringify 7.0.1 (mechanism); protobuf.js 8.7.1 (proof it's not penalized) | **Partial** — needs many same-shape records to amortize compile; keys MUST be passed as data, never interpolated | #1 stringify | **MED** (HIGH only for large homogeneous record arrays = our 8.05× worst case) |
| 3 | **Object-literal decode codegen** — construct `{a:v0,b:v1,…}` in one shot ⇒ no hidden-class transitions | msgpackr 2.0.4 / cbor-x | **Partial** — feasible where keys are fixed-order (our `FastKeyMatch` already gates this); needs a clean divergence fallback | parse (speed) | **MED** |
| 4 | **Per-record generated constructor** (monomorphic construction) | avsc 6.0.0-rc.1 | **Partial** — but returns a *typed instance*, tension with plain-`{}` mandate; strong **injection warning** | parse | **LOW–MED** |
| 5 | **Scope-injected codegen utility** (fn from string parts + `Function` + injected deps; no text interpolation) | `@protobufjs/codegen` (protobuf.js 8.7.1) | **Yes, as tooling** — the safe way to do #2/#3 if we adopt them | #1 / parse | **infra** |
| 6 | **AOT ≈ runtime codegen** (reflected within noise of static) | protobuf.js 8.7.1 | N/A — *evidence*, underwrites the headline | supports #1 | **evidence** |
| 7 | **Structural offset/index pre-scan** (eager tape → plain `{}`) | simdjson On-Demand (concept) | Maybe, non-lazy variant only | #4/parse (E2) | **LOW** (scanning ~8% of budget) |
| 8 | **Zero-copy lazy field access** (vtable offsets) | FlatBuffers | **NO** — lazy facade already rejected (doc 09 §5) | — | **rejected** |

---

## Analysis — why the numbers look like they do

- **The win is per-record *setup* removal, not magic.** Every one of these libraries earns its speed
  the same way: pre-decide, once per shape, everything that native code must re-decide per value —
  which keys exist, their order, their emitted prefix, and (with a schema) their type. fast-json-
  stringify bakes that into a function; msgpackr bakes it into a cached object-literal builder; avsc
  into a constructor. lightning-yaml's dumper currently *re-does* per record: `Object.keys(rec)`, a
  per-key indent-cache lookup, and `isPlainScalarSafe`/quote checks on the key. On xlarge-records
  (thousands of identical shapes) that repeated per-record bookkeeping is a plausible chunk of the
  8.05× gap — and it is exactly what a per-shape template removes.
- **Amortization is the whole story, and it cuts both ways.** protobuf.js proves generated code isn't
  slower once warm; fast-json-stringify proves it *loses* when there's nothing to amortize over (large
  single arrays vs native's bulk path, or dynamic/`additionalProperties` shapes). Translation for us:
  codegen helps **large homogeneous record collections**, hurts **small (1 KB, one record) and
  shape-churning** inputs. The small-records fixed-per-call overhead we already see (2.32× parse) is
  the same tax — do not pay a compile on top of it.
- **Decode-codegen (msgpackr 3.3×) is a stronger, cleaner win than encode-codegen** in the prior art
  (msgpackr's own encode is *not* faster than JSON). That is a hint that the object-literal
  construction trick (our parse path) may be higher-leverage per unit risk than serializer codegen —
  *except* that our parse is already at 2× and healthy, whereas stringify at 8× has more gap to close.
  So: stringify gets the effort (bigger gap), parse gets the object-literal idea as a secondary lead.
- **Memory (#4) gets little.** These tricks change *how fast* and *with how much transient churn* an
  object is built, not *how big it is when retained*. Our retained-heap 2.3–2.7× is a size problem;
  object-literal construction only helps it in the specific case where our objects are currently in
  V8 **dictionary (hash) mode** and literal construction would keep them in **fast-property** mode.
  That is a concrete, cheap thing to check (`%HasFastProperties(obj)` under `--allow-natives-syntax`)
  and is the single memory-relevant lead from this survey.

## Conclusion (MIXED, leaning YAY for one axis)

- **Stringify (direction #1): YAY, scoped.** Per-shape specialization is proven (fast-json-stringify
  1.6–2.4× on objects) and runtime codegen is proven un-penalized (protobuf.js reflected ≈ static).
  Prototype it — but stage it: **template cache first (no `new Function`), codegen second**, and target
  **only large homogeneous record arrays** (our 8.05× worst case). Expect it to *close the gap*, not
  beat native.
- **Parse: MIXED/MED.** msgpackr's object-literal decode codegen is a real ~3.3× lever *for its
  format*; for us it's a speculative speed lead gated by fixed-order keys (which we already detect) and
  by `new Function` amortization. Worth a scratch prototype after stringify.
- **Memory (direction #4): NAY**, except the one `%HasFastProperties` dictionary-mode check.
- **Zero-copy/lazy (FlatBuffers, simdjson On-Demand): NAY** — collides with the plain-`{}` mandate and
  the already-rejected facade.

## How to apply

**A1 — Dumper "record template" cache (do this first; direction #1).** *Target:* `src/index.ts`
`dumpScanRefs` (4399), `writeCollectionBody` (4732), `writeEntryValue` (4766). When `dumpScanRefs`
sees a run of same-shape objects (it already ref-counts every object), attach to that shape a cached
array of **pre-rendered key prefixes** — the exact `\n<indent>key:` bytes, with the key already
quoted/escaped as needed — keyed by (ordered-key-list, indent depth). In the write pass, for a record
whose shape matches, replace `Object.keys(rec)` + per-key indent/quote work with a tight indexed loop:
`out += prefix[i]; writeValue(rec[keys[i]])`. *Est. gain:* on xlarge-records/large-records
(homogeneous), plausibly **shave a meaningful fraction of the 8.05×/4.79× gap** by deleting per-record
key bookkeeping; **near-zero** on small/heterogeneous (guard so they keep the current path).
*Confidence:* **medium** (mechanism is sound and matches fast-json-stringify's own source of speed;
exact fraction unmeasured). *Risk:* low — no `new Function`, output must remain byte-identical (add a
round-trip test vs the current dumper on all fixtures).

**A2 — `new Function` per-shape serializer (only if A1 leaves gap; direction #1).** *Target:* a new
codegen helper modeled on `@protobufjs/codegen` (scope-injected, keys passed as a **data array**,
never interpolated as source). Compile one serializer per shape, cache by shape id, **gate on a record
count threshold** so the compile amortizes (e.g. ≥N same-shape records seen). *Est. gain:* the
increment beyond A1 (removing per-value dispatch); *Confidence:* **low-medium**; *Risk:* **medium** —
compile-cost regressions on small/churning inputs (mitigate with the threshold + fallback), and the
**security constraint is non-negotiable** (see Risks).

**A3 — Object-literal decode codegen (secondary; parse).** *Target:* the block-map construction path
(`storeKey` 1567, `parseBlockNode` 2864) behind the existing `FastKeyMatch` gate. When a sibling
record matches the cached shape, build via a cached `{k0:…,k1:…}` builder instead of incremental
assignment. *Est. gain:* speculative parse speed-up on large homogeneous arrays (msgpackr saw 3.3× for
its format; ours would be far less since we're already at 2× and scanning is shared); *Confidence:*
**low**; *Risk:* medium (divergence fallback complexity). Prototype in scratch before committing.

**A4 — Free memory check (direction #4).** Under `--allow-natives-syntax`, assert
`%HasFastProperties(obj)` on medium-records parse output. If **false** (dictionary mode), A3's literal
construction likely *also* reduces retained heap — promoting A3's priority for the memory gap. If
**true**, confirm codegen is a pure speed play and drop the memory angle. *Confidence:* high that the
*check* is decisive; unknown which way it resolves.

## Risks (codegen-specific, must respect)

- **Untrusted keys ≠ trusted schema.** avsc's `case`-field `SyntaxError` (issue #291) and its
  maintainers' "SQL-injection-like" caution are the direct warning: keys come from the document. Any
  codegen MUST pass keys/prefixes as **scope data** (arrays, bracketed string literals), never splice
  key text into the function source as identifiers. A `__proto__`/`constructor` key must not alter
  generated control flow (we already guard `__proto__` at 1567 — keep that).
- **Amortization tax.** Do not compile on small/heterogeneous inputs; gate on shape-repeat count.
  fast-json-stringify's large-array and dynamic-object regressions are the cautionary data.
- **Output identity.** Everything must still emit plain `{}`/arrays and byte-identical YAML; add
  round-trip equivalence tests vs the current dumper across all fixtures before/after.

## Reproduce (sources; fetched 2026-07-14)

- msgpackr 2.0.4: README/benchmark.md + author blog — https://github.com/kriszyp/msgpackr ·
  https://raw.githubusercontent.com/kriszyp/msgpackr/master/benchmark.md ·
  https://kriszyp.medium.com/building-the-fastest-js-de-serializer-a413a2b4fb72 · version from
  https://raw.githubusercontent.com/kriszyp/msgpackr/master/package.json
- fast-json-stringify 7.0.1: https://github.com/fastify/fast-json-stringify ·
  https://raw.githubusercontent.com/fastify/fast-json-stringify/main/README.md (benchmark on Node
  22.14.0)
- avsc 6.0.0-rc.1 (stable 5.7.x): https://github.com/mtth/avsc · codegen/security evidence
  https://github.com/mtth/avsc/issues/291 · version from
  https://raw.githubusercontent.com/mtth/avsc/master/package.json
- protobuf.js 8.7.1: https://github.com/protobufjs/protobuf.js · codegen utility
  `@protobufjs/codegen`
- typia (AOT contrast): dev.to samchon "10x faster JSON.stringify" (compile-time transformer)
- FlatBuffers / simdjson On-Demand: concept references (lazy/zero-copy) — noted, not adopted.

> Numbers above are each library's OWN published claims at the cited version; they were not
> independently reproduced (web-only survey). Ratios, not absolute ops/sec, are the transferable part.
```
