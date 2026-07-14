> Origin: a user-supplied V8
> optimization guide, reviewed 2026-07-12 against the dossier and edited
> where the dossier's *measured* results take precedence. **Editorial
> changes made:** (1) §3's "decode the source into a typed array" bullet
> was replaced — it contradicts the measured string-substrate decision
> (docs 05/06/07, verdict in doc 10); (2) §3's token bullet was reframed
> for our tokenizer-less design; (3) §6's recommendation to return `Map`
> for mapping payloads was inverted to plain objects (API parity +
> measured ~2× `Map` build cost, doc 05 §4); (4) §7 was trimmed
> (Vitest specifics made conditional; noted mitata's built-in DCE guard);
> (5) the checklist was updated to match. Everything else is as received.

# V8 Optimization Guide

**Audience:** the Claude Code agent doing future work on this YAML parser.
**Scope:** execution speed of turning a source string into a data structure in V8 (Chrome / Node). Not DOM, not bundle size, not lazy-loading.
**Status:** engineering guidance. Read this before making performance changes. When a change here conflicts with correctness, correctness wins — but most of this guidance costs nothing in correctness. When it conflicts with the dossier's measurements (docs 05–07, 10), the dossier wins.

---

## 0. TL;DR — the decision this document makes

1. **We target Maglev as the floor and TurboFan for the innermost scanner.** These are not competing strategies. Code written to satisfy TurboFan also satisfies Maglev; the difference between the tiers is *threshold and aggressiveness*, not *different rules*. So: write the hot path to TurboFan quality, and it is automatically Maglev-quality too.
2. **Do not spend effort optimizing code that never gets hot.** An optimization aimed at TurboFan is worthless if the function never tiers up to TurboFan. Cold, run-once code stays in the interpreter forever, and TurboFan-shaped micro-tricks there add complexity for zero gain (and can make the interpreter path slower). Before optimizing a function, know which tier it actually reaches.
3. **The lever is structural, not declarative.** JS has no inlining pragma and no type hints the engine reads (TypeScript types are erased and invisible to V8). You make code fast by writing it so there is only *one obvious shape* for the engine to observe — one argument type per function, one hidden class per node type, one element kind per array.
4. **We make tier residency observable and regression-tested** (see §7), so this stops being a conceptual aspiration and becomes: run a script, see whether the scanner hit Maglev / TurboFan, fail CI if it regressed or started deopting.

---

## 1. The V8 tier pipeline (the mental model)

All JS starts interpreted and climbs tiers as it gets "hot" (roughly: as call count / executed-bytecode budget crosses thresholds). Cold code never leaves the bottom. There are four tiers:

| Tier | Name | What it is | Inlining? | Type speculation? |
|---|---|---|---|---|
| 1 | **Ignition** | Bytecode interpreter. Where every function begins. | No | No |
| 2 | **Sparkplug** | Baseline JIT. Compiles bytecode to straight-line machine code, fast to produce. *(This is the "third engine" that's easy to forget.)* | No | No |
| 3 | **Maglev** | Mid-tier optimizing JIT. Fast to compile, does inlining and type speculation, less aggressive than the top tier. | Yes | Yes (moderate) |
| 4 | **TurboFan** | Top-tier optimizing JIT. Slow to compile, most aggressive: inlining, escape analysis, constant folding, strength reduction, loop hoisting. | Yes | Yes (aggressive) |

**Naming note for future-proofing:** V8 is mid-migration on its top tier. "Turboshaft" is a newer compiler backend, and "Turbolev" is an emerging top tier that feeds Maglev's IR into Turboshaft. If tooling or traces mention Turboshaft/Turbolev, treat them as "the top optimizing tier" — the guidance in this document is unchanged. The four-tier model above is the one to reason with.

**The single most important consequence:** tier residency is a function of hotness. A function called once on a small document may execute entirely in Ignition and never even reach Sparkplug. Optimizations that only pay off under TurboFan are dead weight there.

*(Dossier tie-in: doc 11 §11 makes the mirror-image point — warm-loop benchmarks overstate everyone's steady state, and the dominant real-world YAML workload, "parse one config file and exit", runs in the interpreted/baseline tiers. Both views matter.)*

---

## 2. The decision: which tier do we write for?

Split the codebase mentally into two regimes.

### Cold / one-shot path
Examples: top-level entry that runs once per `parse()` call on a small document; error-path formatting; config handling.
- **Reaches:** Ignition, maybe Sparkplug.
- **Optimize for:** less bytecode, fewer allocations, simple control flow. The interpreter rewards *small and simple*, not *clever*.
- **Do NOT** add TurboFan-shaped micro-optimizations here. They won't fire and they cost readability.

### Hot path (this is where the wins are)
Examples: the inner tokenizer/scanner looping over every byte of the source; any function called once per token / per line / per node over a large document; `parse()` itself when called repeatedly (server, editor, test loop).
- **Reaches:** Maglev, then TurboFan, *if* it actually gets hot.
- **Optimize for:** the fast-tier rules in §4. This is where monomorphism, stable shapes, and small inlinable helpers pay for themselves.

### The rule
> **Write the innermost scanner to TurboFan quality (§4). That automatically makes it Maglev-quality. Everywhere else, write simple code and don't pretend it's hot.**

There is a second, easy-to-miss half of the decision: **make sure hot code actually gets hot.** You cannot micro-optimize a cold function into speed. If the scanner processes the whole input in one tight loop, it accrues hotness quickly and tiers up mid-parse on large inputs. If it's called only a handful of times, consider a startup warmup pass over a representative sample so it's already optimized before real input arrives (this is a legitimate production technique — same mechanism as the `%PrepareFunctionForOptimization` dance in §7, minus the flag). Forcing optimization never changes *what* the engine assumes; it only changes *when* — it still uses observed feedback, never anything you "declared."

---

## 3. Architecture that keeps the hot path hot (parser-specific)

These are structural choices that determine whether the fast-tier rules in §4 are even achievable.

- **Scan the flat JS source string directly with `charCodeAt`, and hop long runs with `indexOf`.** *(Edited — the original recommended decoding into a `Uint8Array`/`Uint16Array` first; the dossier refutes that for this parser: every key/scalar must become a JS string, and `TextDecoder.decode` of a short subarray costs ~124–150 ns vs ~7–11 ns for `str.slice` (docs 05 §2, 06 (e)); raw scan-loop speed is contested (doc 10, refuted verdict on Design A's V8-behavior bundle) but scanning is only ~8 % of the budget while materialization dominates (doc 06). Revisit a bytes prescan only with profiler evidence.)* `indexOf` runs at memchr/SIMD speed (~5+ GB/s) and is the legal substitute for native SIMD scanning (doc 03 T8).
- **Track positions as integers; never build a token stream.** *(Reframed — the original suggested emitting `(type, start, end)` token tuples; our design is tokenizer-less (doc 07 §2): readers compose final JS values directly, holding `(start, end)` offsets in locals and materializing each scalar with exactly one `slice`. The underlying principle stands and is the dossier's core lesson: no intermediate strings or token objects while scanning — that's eemeli/yaml's 15–100× tax, doc 02.)*
- **Never read the source with `str[i]`.** `str[i]` produces a one-character string every iteration; `charCodeAt(i)` returns an integer and allocates nothing. This alone is often 2–5× on a scan loop, at *every* tier.
- **Precompute char-code constants** (`const COLON = 58, NEWLINE = 10, SPACE = 32`) outside loops. Detect keywords by length + char codes, not full string `===`. (Char-class `Uint8Array(256)` flag tables generalize this — doc 03 T2, doc 07 §1.)
- **Minimize allocation in the loop.** Fewer objects → less GC → faster, independent of tier — and allocation *rate* is what the peak-RSS harness punishes (doc 02 meta-lesson). Flat representations beat deep trees.

---

## 4. LEAN ON THESE — how to stay in Maglev/TurboFan and get inlined

Every item here narrows what the engine has to speculate about, so it specializes on the *first* observation instead of after churn, and stays specialized.

- **One argument type per function (monomorphism).** A hot helper must see the same type every call. `add2(x)` that always gets a number/Smi inlines cleanly and the `+2` folds into the caller. If it sometimes gets a number, sometimes a string, sometimes an object, the call site goes polymorphic → megamorphic → won't inline / deopts. If you need to handle multiple types, split into per-type functions or tag + dispatch. *(This is exactly js-yaml's `state.result` mistake — doc 01 weakness #12.)*
- **Keep hot functions small.** Inlining is *budgeted*. Tiny functions always inline; large ones, or ones called from many sites, blow the budget and stay real calls. Small readable helpers are free once hot **because the compiler erases the call boundary** — extracting for readability is the right call, provided they stay small and monomorphic. *(Dossier constants: 460 bytecode per inlinee, ≤30-bytecode helpers inline nearly always, >60 KB bytecode never optimizes — doc 05 §3.)*
- **Stable hidden classes for every internal fixed-field object.** Initialize *all* properties in the constructor, in the *same order*, *every* time. Then every instance shares one hidden class and call sites reading those objects are monomorphic from instance #1. Do not add properties conditionally or after construction.
- **Packed, single-kind arrays.** V8 ranks element kinds `PACKED_SMI` > `PACKED_DOUBLE` > `PACKED` > any `HOLEY`. Push sequentially. For known-size numeric *internal* buffers use a typed array (`Uint32Array`, etc.) — contiguous, unboxed, monomorphic.
- **Keep integers in Smi range.** Char codes, indices, lengths are all small integers → tagged, unboxed, free. Avoid float math on the hot path; a stray double becomes a boxed HeapNumber.
- **Pin representation with coercion idioms where useful.** `x | 0` / `x >>> 0` force int32; `+x` / `Math.fround(x)` force float. (Heritage: asm.js used exactly these as type annotations.) Useful to stop an int path from silently going float.
- **Integer `switch` for dispatch.** Assign `const T_KEY = 0, T_SCALAR = 1, ...` and switch on the integer tag. Dense integer switches compile to jump tables — beats string comparison or property-based dispatch.
- **Plain `for` loops with cached `.length`** on the hottest inner loops. `.map`/`.forEach`/`.reduce` are fine off the hot path but add a per-element callback and polymorphism risk in it.

---

## 5. AVOID THESE — how you accidentally break out of the fast tier

Each of these either prevents optimization or, worse, causes a **deopt loop** (optimize → deopt → re-optimize repeatedly), which is slower than never optimizing at all. These are the things to grep for in review.

- **Polymorphic / megamorphic call sites.** Feeding one function mixed types is the #1 cause. A property access that sees >4 object shapes goes megamorphic and optimization is abandoned for that site. Generic "walk any node" code that touches many shapes is a classic offender.
- **Holey / mixed-kind arrays.** `delete arr[i]`, `arr[i] = undefined`, sparse writes (`arr[1000] = x` on a small array), or `new Array(n)` then filling — each drops the array to a slower holey kind, permanently. Don't manipulate `.length` to pre-size; build results with `push` (doc 05 §4).
- **Shape churn on objects.** Conditionally adding properties, varying init order, or using plain objects as dictionaries with dynamic keys creates a new hidden class each time and defeats inline caches.
- **Type changes mid-function.** A variable that's an int then reassigned a string forces the optimizer to widen or bail.
- **Floats leaking into an int path** → boxing → deopt on a loop you thought was integer-only.
- **`arguments` object, `eval`, `with`.** Use fixed/rest params; never `eval`/`with` on any path that matters.
- **`try/catch` in the *tightest* loop.** Modern TurboFan handles try/catch fine in general, but keep it out of the innermost scan loop if trivially avoidable.
- **Recreating the hot function as a fresh closure per call.** If the scanner is a closure rebuilt every `parse()`, it can't accumulate feedback and can't be pinned for optimization. Hoist hot functions to stable top-level references. *(Design A already does this: module-level parser state, no per-parse closures — doc 07 §2.)*

---

## 6. The one real architectural tension: YAML map keys

YAML mappings have arbitrary string keys. Arbitrary dynamic keys fight hidden-class caching and can push plain objects into dictionary mode — a real §5 anti-pattern, but here it's inherent to the data, not a mistake.

**Resolution (edited — the original recommended returning `Map` for mapping payloads; the dossier overrules it):**

- **Mapping payloads (the user-visible output): plain `{}`, always.** API parity with js-yaml/`JSON.parse` demands plain objects, the whole benchmark compares against `JSON.parse` output, and `Map` measured ~2× slower to build than plain objects (doc 05 §4). The dictionary-mode fear is overstated for our data: repeated mapping shapes share hidden classes when keys are assigned in encounter order, and the key-intern cache + previous-sibling key feedback (docs 03 T6, 07 §5) make homogeneous record streams cheap. Genuinely huge or pathologically heterogeneous mappings will go dictionary mode — which is exactly what `JSON.parse` produces for the same input, so it is not a competitive loss.
- **Internal fixed-field structures** (parser state, if any; scratch records): stable-shape objects with one hidden class, per §4 — or module-level scalars, which is what Design A actually uses.
- **Internal string→value lookups** (anchor map, key-intern cache): `Map` or `Object.create(null)` — never a plain `{}` (no `__proto__` hazard, no shape churn). Design A uses `Map`, allocated pay-on-first-use.

---

## 7. Verification & future automated benchmarking

The goal: **make "are we hitting Maglev / TurboFan?" a script you run, not a belief.** Optimization work should be measured — change code, run the bench, see whether the hot functions still reach their target tier, whether throughput moved, and whether anything started deopting. *(This slots into Design A's M7 milestone — doc 07 §8 — which already calls for `--cpu-prof`, `--trace-deopt`, and opt-status checks; this section is the concrete recipe.)*

### What to build (future work)
A benchmark harness over representative YAML fixtures (small/medium/large, flow/block, deeply nested, big scalar blocks) that reports, per hot function:
1. **Tier reached** — Ignition / Sparkplug / Maglev / TurboFan.
2. **Deopt count** — did it optimize and then bounce?
3. **Throughput** — MB/s or docs/s.

…and **fails CI on regression**: a target function dropping below its expected tier, a new deopt appearing, or a throughput drop beyond a threshold.

### How to read tier residency in a test (V8-only)
Node with `--allow-natives-syntax` exposes the intrinsics. Toolchain trap that applies to **this repo**: esbuild-based transforms parse `%GetOptimizationStatus(fn)` as a modulo operator and reject the file — and the repo runs everything through `tsx`, which is esbuild-based. Build the intrinsics through `new Function` with a string body — the transform sees a plain string; V8 compiles it with natives syntax at runtime. *(If Vitest is ever adopted: it must run in the `forks` pool, since the `threads` pool strips `execArgv`; in Vitest 4.x `execArgv` is a top-level `test` option. The repo currently plans `node:test` — doc 07 §8 — where `node --allow-natives-syntax --test` passes the flag directly.)*

Helper (dodges the parser, degrades gracefully if the flag is absent):

```js
// test/helpers/v8.js
const mk = (body, ...a) => { try { return new Function(...a, body) } catch { return null } }
export const prepare      = mk('%PrepareFunctionForOptimization(f)', 'f')
export const optimizeNext = mk('%OptimizeFunctionOnNextCall(f)', 'f')
export const optimizeTF   = mk('%OptimizeTurbofanOnNextCall(f)', 'f') // dedicated top tier
export const getStatus    = mk('return %GetOptimizationStatus(f)', 'f')
export const nativesOn     = !!getStatus
export const BIT = { OPTIMIZED: 1 << 4, TURBOFANNED: 1 << 5, INTERPRETED: 1 << 6 } // SEE CAVEAT
```

The mandatory dance in modern V8: **prepare → call once (collect feedback) → request optimization → call again (trigger compile) → read status.** Because compilation can happen on a background thread, poll rather than assume the status is ready immediately:

```js
// sketch (any test runner): assert the hot function optimizes and stays optimized
prepare(scan); scan(sample); (optimizeTF ?? optimizeNext)(scan); scan(sample)
let s = 0
for (let i = 0; i < 2000; i++) { scan(sample); s = getStatus(scan); if (s & BIT.OPTIMIZED) break }
for (let i = 0; i < 5000; i++) scan(sample)          // hammer with real workload
s = getStatus(scan)
assert(s & BIT.OPTIMIZED, `not optimized, status=${s.toString(2)}`)
assert(!(s & BIT.INTERPRETED), `deopted, status=${s.toString(2)}`)
```

### Caveat that will bite: the status bitmask shifts between V8 versions
The classic layout is `kOptimized = 1<<4`, `kTurboFanned = 1<<5`, but recent V8 added Maglev and reshuffled the bits (some builds report the top tier at a completely different bit). So:
- **Portable assertion:** `OPTIMIZED` set **and** `INTERPRETED` unset → "in some optimizing tier, hasn't fallen back." This is what to gate CI on. It catches the failure we actually care about (deopts / never optimizing).
- **Strict "TurboFan not Maglev":** print `s.toString(2)` once on the exact Node version, read which bit flips, and pin the constant per version. There is no stable cross-version number.
- **Most robust of all:** run the bench with `--trace-opt --trace-deopt` and fail if the trace mentions `deoptimizing` any of our hot functions by name. Zero-deopt is a more stable and more meaningful signal than any tier bit. Distinguishing "hit Maglev" from "hit TurboFan" is exactly the kind of thing to read from `--trace-opt` output, since the bit is unreliable.

### Benchmarking pitfall
If a benchmark loops `scan(sample)` and discards the result, TurboFan may prove the work is dead and delete the loop — you'll measure ~0 and wrongly conclude "fully optimized." Accumulate a value that escapes (sum a byte, return it, assert on it) so the work can't be eliminated. *(The repo's speed harness already handles this: mitata's `do_not_optimize` guard is one of the reasons it was chosen — see README.md. The pitfall applies to any ad-hoc timing script you write outside mitata.)*

---

## 8. Cross-engine note (Safari / JavaScriptCore)

The **optimizations** transfer: JSC has the same shape of machinery (Structures = hidden classes, inline caches, int32 fast path, packed arrays, fast typed arrays) and a multi-tier JIT (LLInt → Baseline → DFG → FTL). So monomorphism, packed single-kind arrays, stable shapes, and small hot functions all help there too. **Do not hard-tune to V8's magic numbers** (Smi range, inlining budgets, the SlicedString/ConsString thresholds) — those differ in JSC. Keep the *shape* of the optimizations, not the constants. *(Matches Design A's engine-coupling risk — doc 07: browser claims stay unquantified until measured.)*

The **verification harness in §7 is V8-only** — JSC has no equivalent user-facing natives syntax. For Safari, profile in Web Inspector instead.

---

## 9. Quick checklist

**LEAN ON**
- [ ] Scan the flat JS string: `charCodeAt` dispatch + `indexOf` hops (never `str[i]`, never a bytes/TextDecoder detour)
- [ ] Offsets in locals; one `slice` per scalar; no intermediate strings or token objects in the loop
- [ ] One argument type per hot function (monomorphic)
- [ ] Hot functions small enough to inline; cold paths out-of-line
- [ ] All fields of internal structs set in constructor, same order → one hidden class
- [ ] Packed single-kind arrays (`push`-built); typed arrays for internal numeric buffers only
- [ ] Integers kept in Smi range; integer `switch` dispatch
- [ ] Plain `{}` for mapping payloads (API parity); `Map`/`Object.create(null)` for *internal* dynamic-key lookups only

**AVOID**
- [ ] Mixed types into one function (polymorphism → megamorphism)
- [ ] `delete`, sparse writes, `new Array(n)`-then-fill, `.length` presizing (holey arrays)
- [ ] Conditional / reordered property init (shape churn)
- [ ] Type of a variable changing mid-function; floats leaking into int paths
- [ ] `arguments`, `eval`, `with`; `try/catch` in the tightest loop
- [ ] Hot function recreated as a fresh closure per parse
- [ ] TurboFan-shaped micro-opts on cold, run-once code

**DECIDE FIRST**
- [ ] Is this function actually hot? If not, write it simple and stop.
- [ ] Does the hot path get hot fast enough, or does it need a warmup pass?
- [ ] Does the bench confirm the target tier (§7), or is this a guess?
