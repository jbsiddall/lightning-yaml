# Enhancement: rewrite lightning-yaml in Dafny with equivalent optimized paths

## Why

We want to support compatibility layers for `js-yaml`, `yaml`, and our own API
through shared parser and serializer code. We also want several implementations
of the same operation where different input shapes benefit from different
optimizations: small configuration files, large generated files, repeated mapping
shapes, strings with no escapes, and unusual YAML constructs.

That can easily become a codebase where each fast path develops slightly
different behaviour. A fix lands in one implementation and misses another.
Compatibility options make that harder to keep under control.

The proposal is to rewrite the parsing and serialization implementation in
Dafny, with a shared semantic specification and proofs that each optimized path
implements it. We should be able to change an implementation or add another
specialization, rerun verification, and know it still produces the same result
and parser state for its supported inputs. The same foundation should support
strong proofs of YAML compliance and clearly specified compatibility behaviour.

**The performance research shows a credible path. Whole-parser performance
parity and complete semantic proofs remain acceptance criteria for the rewrite.**

## Research branch and starting points

Branch: [`research/dafny-performance`](https://github.com/jbsiddall/lightning-yaml/tree/research/dafny-performance).
Start with the [research README](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/README.md)
for reproduction, the full results, compiler source links, and the proof boundary.

- [DirectCast.dfy](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/DirectCast.dfy) and its generated `.js`: native offsets, UTF-16 strings, direct numeric character casts. This is the preferred scanner starting point.
- [NativeChoices.dfy](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/NativeChoices.dfy): automatic and explicit native numeric representation.
- [ExternHotPath.dfy](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/ExternHotPath.dfy), `extern-host.cjs`, and `recheck.cjs`: a specified quote fast-case operation connected to handwritten native JS.
- [MoreHotPaths.dfy](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/MoreHotPaths.dfy): block scanning/trimming, fixed-key matching, and quote scanning using numeric sequences. Include string conversion costs if considering this representation.
- [Shapes.dfy](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/Shapes.dfy) and `postprocess.cjs`: code-shape experiments, a costly intermediate cast, and a focused AST optimization.
- [recheck.sh](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/recheck.sh), `inspect-output.cjs`, and [saved evidence](https://github.com/jbsiddall/lightning-yaml/tree/research/dafny-performance/experiments/dafny-hotpath/evidence/2026-10-09): verification, generated-code inspection, differential checks, and benchmarks.

## Performance evidence

The saved experiment used Dafny 4.11.0 and Node 24.19.0 on Linux x64. Compiler and
dependency execution ran inside bubblewrap with network disabled. These are
isolated operations ported from the parser, measured over varied ASCII strings
and seven rotated rounds. They are not whole-parser or cross-engine results.

Median time per call, on strings around 1,024 UTF-16 units:

| Operation / implementation | Time |
| --- | ---: |
| Flow plain scanner: handwritten JS flag table | 14.890 us |
| Flow plain scanner: unbounded Dafny offsets + Unicode characters | 448.904 us |
| Flow plain scanner: native offsets + UTF-16 character comparisons | 35.954 us |
| Flow plain scanner: intermediate character -> int -> native cast | 63.502 us |
| **Flow plain scanner: direct native character cast** | **8.600 us** |
| Quote fast-case decision: handwritten JS `indexOf` | 0.087 us |
| Quote fast-case decision: native Dafny scalar loop | 10.123 us |
| **Quote fast-case decision: Dafny caller -> JS extern** | **0.098 us** |

<!-- bench:b11b0165694422b20afbbf2e85f72efa1756f21ec7eceb2ac5bb9ca62ae5e7a1 ly:eaf00b1ed7702e4cfa9fff566fbc7f88e989a423 -->

The direct numeric loop was competitive on this workload. The quote scalar loop
was much slower than the engine's native search, and the extern preserved that
search. Retain such intrinsic fast paths when moving surrounding control flow
into Dafny. The quote experiment omits the production parser's memoized search
state; that needs its own contract and measurements.

The expanded checker passed 1,090,754 comparisons, including all single UTF-16
units, supplementary characters, lone surrogates, and valid offsets in generated
mixed strings. That is useful runtime evidence, not an all-input equivalence proof.
The old Unicode variants were timed on ASCII and their input conversion was
excluded from timing. Bundle size and allocation costs still need measurement.

<!-- bench:b11b0165694422b20afbbf2e85f72efa1756f21ec7eceb2ac5bb9ca62ae5e7a1 ly:eaf00b1ed7702e4cfa9fff566fbc7f88e989a423 -->

## Implementation guide

### 1. Define the common semantics before adding optimized variants

Write ghost reference operations for scanning, scalar decoding/resolution,
collections, aliases/tags, document boundaries, and serialization. Specify
results, consumed input, parser-state updates, errors and source locations,
termination, and relevant observable JS behaviours such as alias identity and
mapping key handling. For serialization, specify both emitted text for a chosen
option profile and the relevant round-trip properties.

Give each optimized method a postcondition against the same reference operation.
Where it needs a narrower input domain, prove that the dispatch guard establishes
that precondition. Prove coverage and that the fallback implements the same
operation. This lets variations specialize for a niche without silently
changing its behaviour.

Rerun verification after every code change in CI. Bounds-only postconditions
cannot establish semantic equivalence: the experimental scan methods currently
prove bounds and indexing safety, so their contracts must be strengthened before
production use. The extern example has a semantic contract but trusts the external
implementation to obey it. Track proof coverage and every assumed contract.

### 2. Tie compliance and compatibility to explicit profiles

Use the [official YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/) as the
semantic authority. Map formal definitions and lemmas to linked spec sections;
continue running the [yaml-test-suite](https://github.com/yaml/yaml-test-suite)
and adversarial tests as checks on the model and implementation.

Define versioned option/compatibility profiles for `js-yaml`, `yaml`, and the
native API. Reuse the verified core, with profile parameters or verified adapters
for intended differences. Prove optimized variants equivalent **within the same
profile**. Different profiles may intentionally differ, so there is no single
unconditional equivalence theorem for every compatibility mode.

Pin reference library versions for differential checks. Their behaviour is
evidence to investigate; the YAML spec adjudicates default-mode correctness.
Proofs establish the formal compatibility model; exact equivalence to upstream
libraries requires verifying the relevant JS behaviour too, or remains supported
by differential evidence rather than a theorem about their source.
Respect the existing [decisions and deviations](https://github.com/jbsiddall/lightning-yaml/blob/main/README.md#decisions-and-deviations).
YAML 1.1 is currently a non-goal; a compatibility requirement that changes this
needs an explicit maintainer decision recorded there. Complete formal compliance
requires a faithful formal model, not just agreement with a test suite or oracle.

### 3. Keep the generated hot code native

Use the official JS backend initially, pinned to the researched compiler version.
Compile the parser with `--target js --unicode-char false`. This makes Dafny's
characters and offsets UTF-16 units, matching JavaScript string indexing and
allowing raw JS strings at the boundary. Model Unicode scalar validation,
surrogate pairs, and YAML's permitted characters explicitly; UTF-16 indexing
does not itself establish YAML character validity.

Use bounded **newtypes** for executable offsets, lengths, counters, and code units:

```dafny
newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647
newtype {:nativeType "number"} Unit = x: int | 0 <= x < 65536
```

The `Index` range is this experiment's limit, not a YAML grammar restriction.
Choose and document production limits, including index additions, and prove
every arithmetic/indexing bound. A subset type alone does not ensure native
representation. Explicit native attributes make unsupported representations or
unestablished ranges fail rather than quietly introducing a slower representation.
The JS backend supports `"number"`; other backends have other native type names.
These remain mathematical integers with proven bounds, not wrapping int32 values.

Keep arithmetic and character conversion native throughout the loop:

```dafny
var n: Index := |s| as Index;
var c := s[p] as Unit;
```

The researched compiler emits `.length` and `s[p].charCodeAt(0)`. The longer
`(s[p] as int) as Unit` route emits `new BigNumber(...).toNumber()`. Direct casts
avoid that allocation. Prefer simple executable loops, measured helper placement,
and stable primitive representations. Rich ghost specifications can be erased;
executable immutable collections, tuples, wrappers and conversion boundaries
need allocation and throughput measurements.

Use JS `number` deliberately for emitted numeric values where the API requires
it. Dafny `real` is exact rational arithmetic and will not automatically reproduce
JS floating-point, NaN, infinity, or negative-zero semantics. Specify and audit
numeric decoding/formatting boundaries separately.

### 4. Preserve JS intrinsics through small, specified externs

Use `{:extern}` for critical operations such as `indexOf`, slicing, numeric
conversion, and result-object construction where necessary. Keep native numeric
parameters and raw UTF-16 strings, and supply the generated ABI correctly.
Record preconditions, postconditions, and effects; keep the trusted surface small.

The branch demonstrates a direct generated call to `Bridge.__default.quoteEnd`.
Building its semantic contract requires `--allow-external-contracts`, which makes
the trust explicit. Dafny proves callers using that contract; it does not verify
handwritten JS. Audit and differential-test each extern, or verify its supported
JS subset independently, and record the remaining assumption. Compiler/runtime
correctness and the JS host are also part of the trust boundary.

Thin JS/TS adapters may preserve public exports, ESM/CJS, types, JS values and
library compatibility while the semantic implementation moves to Dafny.
[dafny2js](https://github.com/metareflection/dafny2js) wraps official compiled CJS;
its adapters were not performance-tested here. Inspect marshalling and extern
loading before adding it, especially on frequent calls.

### 5. Inspect generated output after compiler or source changes

#### Native structured values and checked TypeScript boundaries

The follow-up [structured-value research](https://github.com/jbsiddall/lightning-yaml/blob/research/dafny-performance/experiments/dafny-hotpath/STRUCTURED_VALUES.md)
demonstrates plain native objects/arrays and opaque JS values without a second
tree conversion, plus the costs of default datatypes/sequences/maps. Start from
its native representation experiments when designing collections; the verified
toy tree and extern contracts are not a complete YAML graph model.

Keep runtime values native and define ghost semantics separately. Model identity,
alias cycles, allocation, mutable heap effects and mapping properties explicitly.
Use specified host builders/readers for dynamic native collections as needed;
avoid constructing a wrapped datatype tree and converting it on every call.
Stringify should read the caller's graph directly. Keep any extern mutation
visible in the model, and audit its implementation and generated ABI.

Keep the public API in checked TypeScript and emit declarations from it. The
official JS output loses argument types under declaration inference; community
emitter signatures and converters have optionality/generic/`any` limitations.
Require strict consumer checks against the built package and matching runtime
boundary tests for callbacks, overloads, omission, null and undefined. A typed
facade does not itself prove the generated/foreign-code boundary sound.

Quick checks after compilation:

```bash
experiments/dafny-hotpath/sandbox.sh node experiments/dafny-hotpath/inspect-output.cjs "$PWD/node_modules"
rg -n 'BigNumber|BigInt|toNumber|CodePoint|UnicodeFromString' experiments/dafny-hotpath/DirectCast.js
```

The AST check focuses on the two direct-cast hot methods and fails on unexpected
numeric wrappers or runtime helpers. Inspect their callees, dispatch guards and
allocations too. Whole generated files can contain unused runtime/newtype helpers
with BigNumber; inspect the **reachable hot path** and the **shipped bundle**
separately. A lexical check does not prove equivalence or good JIT performance.

Esbuild minification reduced code size but retained the costly cast sequence.
Terser/Closure offer general optimization; a custom Babel or TypeScript AST pass
can target compiler-specific patterns, as `postprocess.cjs` demonstrates. Prefer
native source shapes first. If using a postpass, make its scope and preconditions
explicit, fail when expected shapes change, and verify or audit the transformation.
Dafny's source proof does not automatically cover edits to emitted JavaScript.

### 6. Migrate in stages with proof and performance gates

- Establish the pinned compiler, proof runner, generation pipeline, extern list,
  output inspection and reproducible benchmarks in CI.
- Strengthen and integrate the scanner contracts, then prove each dispatch guard
  and optimized variant against the common semantics.
- Move scalar resolution, collection/alias handling, document state and error
  handling to the model, measuring object construction and memory as well as scanning.
- Move serialization and both compatibility layers, preserving public API,
  option profiles, emitted values, errors and supported return types.
- Keep the existing implementation available during comparison; switch production
  paths after their proofs, runtime checks and end-to-end performance gates pass.

Follow the existing [target-workload research](https://github.com/jbsiddall/lightning-yaml/blob/main/site/src/content/docs/research/notes/2026-07-16-real-world-yaml-optimization-profile.md)
and [V8 guidance](https://github.com/jbsiddall/lightning-yaml/blob/main/site/src/content/docs/research/notes/2026-07-12-v8-optimization-guide.md).
Measure small-file/cold-start cost, large-file throughput, block and flow YAML,
escaped and unescaped quotes, supplementary characters, aliases/tags, malformed
input, repeated keys/shapes, stringify, and compatibility modes. Check supported
Node versions and browser engines. Profile deopts and allocations when results
change. Include conversions, adapters, dispatch, runtime startup and object building
in end-to-end measurements.

## Acceptance criteria

- [ ] Common semantic specifications linked to YAML sections and compatibility profiles.
- [ ] Semantic equivalence and guard/coverage proofs for every optimized Dafny path.
- [ ] CI reruns verification after every change, with explicit tracking of axioms/extern assumptions.
- [ ] Pinned, reproducible JS generation and inspection; no unexpected arbitrary precision, wrappers, conversions or allocations in critical paths.
- [ ] Extern contracts, ABI loading and focused runtime checks documented; no claim that trusted JS has been proved by Dafny.
- [ ] Native output/input graph handling preserves aliases, cycles, property behaviour and null/undefined semantics, with explicit heap/effect contracts and no unmeasured full-tree conversion.
- [ ] Declarations emitted from the checked TS public API; strict built-package consumer checks and runtime boundary tests cover optionality, overloads, callbacks and generated ABI changes.
- [ ] Existing typecheck, consistency, parser, stringify, adversarial and yaml-test-suite gates pass, with no conformance regression.
- [ ] Versioned compatibility checks cover supported options and observable behaviour.
- [ ] Full parse/stringify throughput, startup, peak memory and shipped bundle/runtime dependency measurements meet the project's performance goals across representative workloads.
- [ ] Formal-model coverage and accepted deviations are recorded before claiming YAML compliance.

Compiler details and exact reproduction commands are in the research README.
The two microbenchmarks establish feasibility for particular kernels; the full
rewrite ships when the end-to-end gates establish the intended result.
