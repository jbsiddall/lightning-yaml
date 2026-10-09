# Dafny to JavaScript performance research

There is a credible route to preserving lightning-yaml's performance while moving
its implementation and proofs to Dafny. This experiment demonstrates native
numeric scanning and a working JavaScript extern. Whole-parser performance,
memory, bundle size, YAML compliance, and equivalence proofs remain implementation
work. The enhancement's implementation guide is [IMPLEMENTATION.md](IMPLEMENTATION.md).

Research branch: [`research/dafny-performance`](https://github.com/jbsiddall/lightning-yaml/tree/research/dafny-performance).
Parser baseline: `eaf00b1ed7702e4cfa9fff566fbc7f88e989a423`.
Tools used: Dafny 4.11.0, Node 24.19.0 on Linux x64, bignumber.js 9.3.1,
TypeScript 5.9.3, esbuild 0.28.1. Compiler and dependency execution ran in
bubblewrap with network disabled, the host read-only, and this worktree writable.

## Useful files

| Files | What they establish |
| --- | --- |
| [DirectCast.dfy](DirectCast.dfy), [DirectCast.js](DirectCast.js) | Recommended starting point: bounded native offsets and code units, raw UTF-16 strings, direct character casts; no BigNumber in the two hot method bodies. |
| [NativeChoices.dfy](NativeChoices.dfy), [NativeChoices.js](NativeChoices.js) | Automatic native representation for an unannotated bounded integer newtype, plus an explicit native character cast. |
| [ExternHotPath.dfy](ExternHotPath.dfy), [extern-host.cjs](extern-host.cjs), [ExternHotPath.js](ExternHotPath.js) | Ghost quote specification and a direct call to a trusted handwritten `indexOf` implementation. `recheck.cjs` supplies the external method when loading the generated module. |
| [Scan.dfy](Scan.dfy), [Native.dfy](Native.dfy), [NativeUtf16.js](NativeUtf16.js) | Unbounded offsets, native offsets with Unicode scalar wrappers, and the same native-offset source compiled for UTF-16. |
| [CodeUnits.dfy](CodeUnits.dfy), [MoreHotPaths.dfy](MoreHotPaths.dfy) | Numeric-sequence experiments: flow scanning, block scanning with whitespace trimming, fixed-key matching, and quote scanning. Input conversion has a cost. |
| [Shapes.dfy](Shapes.dfy), [Shapes.js](Shapes.js) | Flattened character comparisons and numeric comparisons that take the slower intermediate `as int` route. |
| [postprocess.cjs](postprocess.cjs), `Shapes.rewritten*.js`, `Shapes.min.js` | Narrow TypeScript AST rewrite and esbuild comparison. Exactly four approved round trips must match; otherwise the pass fails. |
| [inspect-output.cjs](inspect-output.cjs) | Quick AST check for accidental arbitrary precision, character wrappers, or Dafny runtime helpers in the direct-cast hot bodies. |
| [recheck.cjs](recheck.cjs), [recheck.sh](recheck.sh) | Expanded differential validation and rotating-order median benchmarks. |
| [bench.cjs](bench.cjs), [more-bench.cjs](more-bench.cjs), [run.sh](run.sh) | Earlier representation/conversion experiments and additional hot paths. |
| [evidence/2026-10-09](evidence/2026-10-09) | Saved raw measurements; subsequent runs write separate local result files. |
| [STRUCTURED_VALUES.md](STRUCTURED_VALUES.md), `Structures.dfy`, `OpaqueValue.dfy`, `structures-check.cjs`, `structures-run.sh` | Runtime collection costs, native nested objects/arrays, wrapper erasure, opaque JS values, and a verified toy native-tree reader/builder with trusted extern contracts. |
| [type-audit.cjs](type-audit.cjs) | Official generated JS declaration inference, community emitter-derived type fixtures, and strict consumer checks for a small typed facade. |
| [native-values/README.md](native-values/README.md) | Runnable native-value bridge with explicit ghost graph/heap effects, checked TS facade, generated-output guard, and combined build/check/test command. |

## Measured results

The initial saved expanded run used seven rotated timing rounds and their median,
5,000 calls per round for most variants, and 500 for the unbounded-offset version.
Each length label represents 128 varied ASCII strings with a prefix around that
length and a stop character. Input conversion for the old Unicode representations
was outside timing, which benefits those baselines. This is an isolated kernel
comparison against ports of the parser's operations, not a full parser benchmark.
The saved repeat run records the portable runner's validation and measurements
too; the tables below consistently use the initial saved run.

Flow scanner, microseconds per call; lower is better:

| Implementation | ~64 units | ~1,024 units |
| --- | ---: | ---: |
| Handwritten JS flag-table scanner | 0.959 | 14.890 |
| Dafny unbounded offsets + Unicode characters | 27.805 | 448.904 |
| Native offsets + Unicode characters | 6.410 | 100.802 |
| Native offsets + UTF-16 character comparisons | 2.118 | 35.954 |
| Flattened UTF-16 character comparisons | 2.025 | 33.043 |
| **Direct character-to-native-unit cast** | **0.572** | **8.600** |
| Character -> unbounded int -> native unit | 3.904 | 63.502 |
| Intermediate-cast version + esbuild minification | 4.560 | 73.943 |
| Focused AST rewrite | 0.659 | 10.808 |
| Focused rewrite + esbuild minification | 0.670 | 11.302 |

<!-- bench:b11b0165694422b20afbbf2e85f72efa1756f21ec7eceb2ac5bb9ca62ae5e7a1 ly:eaf00b1ed7702e4cfa9fff566fbc7f88e989a423 -->

Quote fast-case kernel:

| Implementation | ~64 units | ~1,024 units |
| --- | ---: | ---: |
| Handwritten JS `indexOf` helper | 0.079 | 0.087 |
| Dafny direct-cast scalar loop | 0.774 | 10.123 |
| Dafny caller -> JS `indexOf` extern | 0.072 | 0.098 |

<!-- bench:b11b0165694422b20afbbf2e85f72efa1756f21ec7eceb2ac5bb9ca62ae5e7a1 ly:eaf00b1ed7702e4cfa9fff566fbc7f88e989a423 -->

The native flow loop was competitive on this workload. The quote loop remained
far slower than the engine's native search, so preserving `indexOf` through an
extern is essential for that case. This helper models the fast-case decision;
it does not implement the complete quoted parser or its memoized search state.
Absolute times and relative results depend on engine, workload, and JIT behaviour.

The expanded checker passed **1,090,754 comparisons**, covering every single
UTF-16 unit, seeded mixed strings, supplementary characters and lone surrogates,
and every valid start offset in its mixed-string cases. The Unicode baseline is
timed only on ASCII. These checks establish observed agreement, not universal
equivalence or the validity of every input as a YAML document.

<!-- bench:b11b0165694422b20afbbf2e85f72efa1756f21ec7eceb2ac5bb9ca62ae5e7a1 ly:eaf00b1ed7702e4cfa9fff566fbc7f88e989a423 -->

Esbuild reduced the generated Shapes module from 35,703 to 17,465 bytes, while
retaining the expensive conversions. This includes the generated runtime and is
not a shipped-library bundle measurement. The focused AST pass removed those
conversions, but the direct Dafny cast is simpler and keeps the improvement in
the verified source.

<!-- bench:3bbbd1edee84208c922a28da291840856ef92f304b69dc46f834d2c85f45e805 -->

## Source choices that matter

Compile the JS parser with `--unicode-char false` to model JavaScript UTF-16
offsets and accept raw JS strings at the boundary. Specify YAML character
validation and supplementary-character handling separately in the semantic model.

Use bounded **newtypes**, with native representation explicitly requested:

```dafny
newtype {:nativeType "number"} Index = x: int | 0 <= x < 2147483647
newtype {:nativeType "number"} Unit = x: int | 0 <= x < 65536
```

This example requires `|s| < 2147483647` and a valid start offset. Prove bounds
for arithmetic and indexing; choose production limits deliberately. JS's backend
supports `"number"`, not the `"byte"`/`"int"` names used by other backends. A subset
of `int` alone does not guarantee this representation. Native selection can also
be automatic, as NativeChoices demonstrates. This is constrained mathematical
integer arithmetic, not wrapping machine arithmetic.

Keep values native throughout the loop. `s[p] as Unit` produces
`s[p].charCodeAt(0)`; `(s[p] as int) as Unit` produces an intermediate BigNumber
followed by `.toNumber()`. Direct native length casts are optimized to `.length`.
Use unbounded integers and rich immutable structures in ghost specifications
where useful; measure their cost when used in executable hot code.

## Reproduce

Use Dafny 4.11.0, Node, and bubblewrap on PATH. A Nix-provided compiler or an
absolute path to the Dafny launcher works; the machine-specific Nix store symlink
used in the original session is deliberately excluded from the branch. Install
the root repository dependencies using its normal setup instructions, and install
the pinned experiment dependency without package scripts:

```bash
npm ci --prefix experiments/dafny-hotpath --ignore-scripts --no-audit --no-fund
bash experiments/dafny-hotpath/recheck.sh "$PWD/node_modules" /path/to/dafny
bash experiments/dafny-hotpath/run.sh /path/to/dafny
```

Both runners enter bubblewrap before executing compiler or dependency code, with
network disabled. Dependencies must already be installed. The sandbox gives the
worktree write access and the host read access; it is not a confidentiality boundary.
In restricted environments, launching bubblewrap may require the outer runner's
permission to create namespaces. Keep compiler/execution inside the inner sandbox.
The expanded runner compiles, verifies, postprocesses, inspects, then validates
and benchmarks. `ITERATIONS` controls most timing counts; recorded runs use the
default. Saved evidence is preserved; local result files are ignored by Git.

Quick check using already generated output:

```bash
experiments/dafny-hotpath/sandbox.sh node experiments/dafny-hotpath/inspect-output.cjs "$PWD/node_modules"
rg -n 'BigNumber|BigInt|toNumber|CodePoint|UnicodeFromString' experiments/dafny-hotpath/DirectCast.js
```

Inspect the hot method bodies and their callees. A whole-file search also finds
runtime and newtype helpers such as `_Is`, which may remain even when the loop
uses only numbers. Reachable allocations, conversions and runtime calls matter;
shipped bundle/runtime dependencies need a separate check. A clean AST check is
a warning detector, not a correctness proof or a performance guarantee.

## Proof boundary and compiler sources

Current scan proofs establish bounds and safe indexing, not equivalence to the
JS reference. The extern caller has a semantic postcondition against QuoteSpec,
but it assumes the JS extern obeys that contract. The AST rewrite relies on
in-bounds UTF-16 access and the expected bignumber.js implementation, and adds
another trusted transformation. Out-of-bounds exception behaviour is outside
its valid input domain. The implementation guide requires stronger contracts
and explicit trust accounting before replacing production code.

- [Native representation documentation](https://dafny.org/v4.11.0/DafnyRef/DafnyRef#sec-nativeType).
- [JS backend's supported native types](https://github.com/dafny-lang/dafny/blob/v4.11.0/Source/DafnyCore/Backends/JavaScript/JavaScriptBackend.cs#L23-L24).
- [Character-to-native conversion and optimized length casts](https://github.com/dafny-lang/dafny/blob/v4.11.0/Source/DafnyCore/Backends/JavaScript/JavaScriptCodeGenerator.cs#L2391-L2435).
- [Native arithmetic selection](https://github.com/dafny-lang/dafny/blob/v4.11.0/Source/DafnyCore/Backends/JavaScript/JavaScriptCodeGenerator.cs#L2248-L2276).
- [Extern declarations](https://dafny.org/v4.11.0/DafnyRef/DafnyRef#sec-extern-declarations).
- [dafny2js](https://github.com/metareflection/dafny2js) generates adapters around compiled CJS; we inspected its architecture, but did not benchmark its adapter output. Check marshalling and extern loading before adopting it for hot calls.
