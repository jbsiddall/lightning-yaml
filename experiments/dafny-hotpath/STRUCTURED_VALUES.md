# Native structured values and TypeScript boundaries

The runtime representation matters as much as the scanner. Dafny can drive code
that builds and reads ordinary JS objects and arrays without converting a second
tree, but its default immutable collections and recursive datatypes are not that
representation. The experiments here establish concrete representation choices;
they do not establish whole-parser throughput or a verified YAML graph model.

## Tested representations

| Dafny source | Observed JavaScript | Consequence for parse/stringify |
| --- | --- | --- |
| Recursive `Value = Null \| Number(...) \| Text(...) \| List(...) \| Object(...)` | Class instance with a numeric `$tag` and payload fields for every constructed value | Scalars and containers are wrapped. Returning native JS values needs a conversion or a different runtime representation. |
| `seq<T>` | `_dafny.Seq`, an `Array` subclass | Array-like storage, with custom prototype and collection helpers. Repeated append creates and copies sequences. |
| `map<string,T>` | `_dafny.Map`, an `Array` subclass containing `[key,value]` pairs | Lookup scans entries; immutable updates copy the entries. This is not a native JS object or built-in `Map`. |
| `array<T>` | Ordinary fixed-length JS array | No array wrapper. The tested native numeric elements remain numbers. Allocation still has numeric conversion/default-initialization overhead. |
| Single-constructor, single-runtime-field datatype around an array | The same array reference, with default wrapper erasure enabled | The eligible wrapper disappears at call sites. This optimization does not erase the multi-variant `Value` datatype. |
| External opaque `Any` type | Incoming/outgoing JS values passed unchanged | Can carry primitives, null, undefined, objects, arrays, shared references and cycles. Every meaningful operation needs an appropriate external contract and ABI. |
| External `HostValue` class with ghost model plus tiny JS allocators/accessors | Plain objects and arrays created/read by the host operations | Verified Dafny control flow can use native values directly; the host contracts remain assumptions. |

The generated runtime still includes collection helpers and the generated module
still includes unused datatype definitions. Passing values unchanged means no
runtime value wrapping on these paths, not zero code size or zero dispatch cost.
Factories/accessors introduce calls, and output objects/arrays still need their
normal allocations. Measure those costs in the real parser and shipped bundle.

## What the executed checks established

Using Dafny 4.11.0, UTF-16 mode, and Node 24.19.0 inside the existing bubblewrap
sandbox:

- `Structures.dfy` verified with 22 verified units and no errors. Its iterative
  native-tree builder/reader passed at depth 20,000 without recursive traversal.
  Objects had `Object.prototype`, lists had `Array.prototype`, and each
  `items[0]` was exactly the same reference as `child`.
- `OpaqueValue.dfy` verified with 6 verified units and no errors. Its generated
  identity method preserved native primitives (including negative zero and NaN),
  null, undefined, strings with surrogate units, arrays, and a cyclic object.
  This is a pass-through identity check, not a proof of cyclic graph parsing or
  serialization. Its sample array factory returned a plain array of numbers.
- Declaring the external type equality-capable as `Any(==)` does not supply the
  host equality implementation. The compiler emits `_dafny.areEqual(a,b)` for
  `a == b`; plain objects without Dafny's runtime protocol caused a TypeError.
  A specified `Object.is` extern works for the tested native values. Choose the
  required equality semantics explicitly: `Object.is` distinguishes signed zero
  and equates NaN with itself; JS `===` has different scalar behaviour. Neither
  should silently stand in for a profile's numeric or structural equality.
- Appending 256 values through immutable sequence concatenation copied 32,640
  existing prefix elements. Building a map from 256 unique keys copied 32,640
  existing entries and performed 32,640 key comparisons; looking up its last key
  performed 256 comparisons. These are instrumented operation counts, not timings.
- `PlainArray` avoids the explicit initializer's per-element BigNumber work.
  It still emits `Array((new BigNumber(n)).toNumber()).fill(0)` at allocation,
  followed by a native numeric assignment loop. `InitializedArray` emits a
  separate initialization loop with BigNumber construction per iteration.
- `WrappedArray(a)` returns `a` itself with the compiler's default erasable
  datatype optimization. The generated wrapper class can still appear unused in
  the file; inspect actual constructor call sites and the shipped bundle.

<!-- bench:1a123ba6ee41a34b99a6c559eef35796f644f49ce933c9bbb5067eea01f713d0 ly:4d7e751a18084fccd58f00422bcfc6b5acffdc17 -->

The native builder's semantic postcondition uses a ghost unary-tree model. It
proves construction/reading relative to assumed extern allocator/reader contracts.
The runtime checks cover additional shape and alias facts. Neither the model nor
the tests are a proof of YAML alias cycles, arbitrary mapping mutations, JS
floating-point behaviour, or stringify compatibility.

## Recommended implementation design

1. Use rich ghost data for the semantic model, and a separately specified native
   runtime representation. Avoid materializing a wrapped `Value` tree and then
   recursively converting it just to return a parse result.
2. Build native objects and dynamic arrays directly. Dafny's ordinary arrays have
   fixed length; dynamic builders may need small extern operations. Inspect both
   allocation and initialization code. Preserve native strings and number ABI
   choices from the scanner experiment.
3. Let stringify read the caller's existing native graph directly. Avoid a full
   input copy into Dafny maps/sequences. Accessors, property enumeration, native
   `Map`/`WeakMap`, numeric formatting and escaping all need specified semantics.
4. Model a **graph with reference identities**, allocation and mutable heap state,
   rather than only a recursive structural tree. lightning-yaml already supports
   shared aliases and cycles. Define relevant object-property behaviour, null vs
   undefined, arrays, omitted elements where supported, and special mapping keys.
   Preserve the current guarded assignment for `__proto__`.
5. Keep host mutation visible to the proof model through explicit state/effects.
   An opaque type alone does not describe mutation, freshness or aliasing. Extern
   contracts that omit an observable effect can make the proof model inaccurate.
   The toy `HostValue` example only models the read-only tree abstraction needed
   by its tested methods.
6. Track every trusted host operation. Audit/test it against its contract, and
   include it in the TypeScript boundary checks and end-to-end performance gates.
   Structural equality is different from reference identity; do not accidentally
   substitute Dafny collection equality for JS alias identity.

## Community generator

`dafny2js` wraps the official generated JavaScript; it does not replace the
official collection backend. At inspected source revision
`61d181fea579f40e6d782a1f8f60cbdcf4562a36`, its
[sequence and map converters](https://github.com/metareflection/dafny2js/blob/61d181fea579f40e6d782a1f8f60cbdcf4562a36/TypeMapper.cs#L276)
construct Dafny collections on input and produce native containers on output.
Typed recursive datatype conversion recursively processes fields. Some scalar
conversions are skipped when the expression is the identity; this is not a
general guarantee of allocation-free graph conversion. The map importer uses
repeated immutable map updates. Do not put those adapters on every parse or
stringify without measuring them and specifying sharing/cycle behaviour.

These findings come from source inspection; this experiment does not build or
execute the community generator.

<!-- ly:4d7e751a18084fccd58f00422bcfc6b5acffdc17 -->

## TypeScript findings from the preceding audit

`type-audit.cjs` extracts the unmodified compiled official scanner class and adds
an export for declaration emission. TypeScript inferred
`FlowPlainLine(s: any, from: any): number`: it cannot recover Dafny parameter types
or range preconditions from this generated JS.

The same script checks clearly labelled source-derived community emitter
fixtures. Required datatype fields and tagged Option unions do not express the
extra input forms accepted by null-option conversion. Generic function argument
and result relationships can become `unknown`. Converter `any` allows a numeric
payload to pass as an `Option<string>` without a compiler diagnostic. These are
fixtures derived from pinned emitter source, not output from running the tool.

The checks use TypeScript 5.9.3 with `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, and library checking enabled. A small checked scanner
facade passes positive and negative consumer tests. For production, emit
declarations from the checked TS public API, check consumers against the built
package, and test the runtime boundary against those same signatures. Use
`unknown` for unvalidated YAML data and model omission/null/undefined deliberately.
A facade alone does not formally prove the foreign-code boundary sound.

<!-- ly:4d7e751a18084fccd58f00422bcfc6b5acffdc17 -->

## Reproduction

Use the existing pinned dependencies and compiler setup from [README.md](README.md).
The runner enters the existing network-disabled, read-only-host bubblewrap sandbox.

```bash
bash experiments/dafny-hotpath/structures-run.sh /path/to/dafny
experiments/dafny-hotpath/sandbox.sh node experiments/dafny-hotpath/type-audit.cjs
```

The TypeScript audit also needs the repository's installed TypeScript dependency.
It writes temporary extracted/generated fixtures under `.sandbox-tmp/type-audit`.
The structure runner regenerates the committed `.js` files and runs the assertions.

Compiler source references:
[array allocation](https://github.com/dafny-lang/dafny/blob/v4.11.0/Source/DafnyCore/Backends/JavaScript/JavaScriptCodeGenerator.cs#L1374),
[datatype generation](https://github.com/dafny-lang/dafny/blob/v4.11.0/Source/DafnyCore/Backends/JavaScript/JavaScriptCodeGenerator.cs#L332),
[wrapper erasure at field access](https://github.com/dafny-lang/dafny/blob/v4.11.0/Source/DafnyCore/Backends/JavaScript/JavaScriptCodeGenerator.cs#L1704).

<!-- ly:4d7e751a18084fccd58f00422bcfc6b5acffdc17 -->
