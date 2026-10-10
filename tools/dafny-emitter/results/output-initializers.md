# Output initializer experiment

The second official-emitter experiment remains opt-in. It omits 27 explicit
literal initializers in generated output declarations: 18 `false`, three
`0`, and six empty strings. It does not establish a consistent CPU or memory
improvement, and it does not close the 15% replacement target.

The candidate uses unannotated project Dafny inputs. The earlier arrayPush
workload overlay is absent, so these measurements isolate the new emission
rule. Normal project generation and the checked-in runtime remain stock.

## What changed

Only `js-native` opts into a default-false shared output-declaration hook.
The raw default must be exactly `false`, `true`, `0`, `1`, or `""`.
The method must have one non-ghost output and begin immediately with a
direct assignment to it. Resolved output reads, including nested let/lambda
reads, and statement expressions are rejected. Unsupported method/body
shapes and effectful or nonliteral defaults retain stock initialization.
Original assignment lowering and default-expression emission order remain.

Before: `let output = false; output = input;`

After: `let output; output = input;`

This is syntax cleanup, not proven runtime-store elimination. An actual
Node 25 fixture [bytecode check](output-initializers-bytecode.txt) shows
`AssignBoolean` still has 8 bytes of bytecode, one register and an 8-byte
frame in both versions. `LdaFalse` becomes `LdaUndefined`, and `Star0`
remains. This observation is for that fixture, not every eligible method
or optimized-machine-code output. The change creates no known allocation
saving.

## Interpretation

Against the existing Dafny runtime, most CPU paired ranges overlap no change.
Plain-medium stringify is faster in all three pairs, but this short screen
does not attribute that to the emitter or establish a reliable overall win.
Rich stringify retained-heap difference is only -8 bytes, while small-records
parse retains 15,368 more bytes at the paired median. Retained heap includes
compiled code and engine feedback, not just returned objects.

Against current TypeScript main, rich stringify CPU is 30.8% higher and
unescaped-longquotes CPU is 27.0% higher, with all three respective pairs
above 15%. Small-fixture retained-heap excess is 56,240 to 136,000 bytes.
The rich-medium stringify heap ratio is unavailable because one baseline
heap delta is negative; the signed difference is retained. This bounded
subset provides directional evidence, not complete performance acceptance
or semantic equivalence for all inputs.

## Existing Dafny control

Completed in 47.133 seconds external wall time; supervisor 46.614 seconds.

| CPU case | Median change | Pair range |
|---|---:|---:|
| parse · medium-records | -4.6% | -7.0% to 4.4% |
| stringify · medium-records | -13.7% | -16.8% to 5.4% |
| parse · yaml-plain-medium-records | -0.2% | -3.3% to 2.0% |
| stringify · yaml-plain-medium-records | -3.6% | -9.3% to -2.9% |
| parse · yaml-rich-medium | -5.0% | -12.1% to 3.3% |
| stringify · yaml-rich-medium | 2.1% | -6.9% to 2.4% |
| parse options · yaml-plain-medium-records | 0.8% | -6.1% to 3.9% |
| diagnostic.parse · escaped-longquotes | -2.1% | -3.2% to 3.6% |
| diagnostic.parse · unescaped-longquotes | -0.5% | -9.1% to 10.7% |

| Memory case | RSS change | Retained heap change | Heap difference |
|---|---:|---:|---:|
| parse · small-records | 0.5% | 8.0% | 15,368 bytes |
| parse · yaml-rich-small | -0.4% | -0.3% | -960 bytes |
| stringify · yaml-rich-small | 0.3% | 0.8% | 824 bytes |
| stringify · yaml-rich-medium | 0.6% | -0.0% | -8 bytes |

[Raw screen](output-initializers-vs-dafny-node25.json), SHA-256 `baa5348c62c7131ffe352a6704a96aec484da838c77f1ceceff6fda23a6dc370`.
<!-- bench:baa5348c62c7131ffe352a6704a96aec484da838c77f1ceceff6fda23a6dc370 ly:5a03835d9ca0567f87c62951c64ce8b287eaf3c0 candidate-engine:6de58472d3d4375745c4e38ac50ba4eeb74a0f9b1095537753a8c70d87e07f5a -->

## Current TypeScript main

Completed in 46.639 seconds external wall time; supervisor 46.134 seconds.

| CPU case | Median change | Pair range |
|---|---:|---:|
| parse · medium-records | -18.8% | -19.5% to -7.6% |
| stringify · medium-records | 9.2% | 7.1% to 33.3% |
| parse · yaml-plain-medium-records | 0.2% | -5.8% to 1.7% |
| stringify · yaml-plain-medium-records | 10.6% | -4.6% to 20.2% |
| parse · yaml-rich-medium | 10.5% | -18.0% to 28.1% |
| stringify · yaml-rich-medium | 30.8% | 17.6% to 32.1% |
| parse options · yaml-plain-medium-records | -27.8% | -30.3% to -22.9% |
| diagnostic.parse · escaped-longquotes | -11.4% | -18.7% to -5.8% |
| diagnostic.parse · unescaped-longquotes | 27.0% | 24.6% to 29.4% |

| Memory case | RSS change | Retained heap change | Heap difference |
|---|---:|---:|---:|
| parse · small-records | 1.1% | 93.6% | 93,736 bytes |
| parse · yaml-rich-small | 2.6% | 56.0% | 136,000 bytes |
| stringify · yaml-rich-small | 2.9% | 112.9% | 56,240 bytes |
| stringify · yaml-rich-medium | 5.0% | n/a | 32,624 bytes |

[Raw screen](output-initializers-vs-main-node25.json), SHA-256 `d4ee159137b2d8c04f0c7115534c4de333188aa750a9aedb6f534ae5b98dd1ac`.
<!-- bench:d4ee159137b2d8c04f0c7115534c4de333188aa750a9aedb6f534ae5b98dd1ac ly:5a03835d9ca0567f87c62951c64ce8b287eaf3c0 candidate-engine:6de58472d3d4375745c4e38ac50ba4eeb74a0f9b1095537753a8c70d87e07f5a -->

## Code shape and research

Reference: current main `src/core.ts` at `f9e62ca9b3a4df753c76537843255b77d343eb5e`.
The local [V8 guide](../../../site/src/content/docs/research/notes/2026-07-12-v8-optimization-guide.md)
and [tiering audit](../../../site/src/content/docs/research/notes/2026-07-14-jit-tiering-and-deopt-audit.md)
informed the review. Their prior native-TS/Node22 findings are not measurements
of the current generated runtime on Node25.

The emitted runtime has module-initialization IIFEs rather than recurring
expression closures. Its 13 `while (true)` loops correspond to authored
Dafny loops; deleting them as boilerplate would change control flow. The
existing postpass already removes much scalar call-result copying.
A bounded Node25 optimization trace of the existing Dafny control shows
selected hot scanner/parser/writer methods reaching Maglev and Turbofan.
It does not establish stable residency, or recurring deoptimization as
the cause of the native-TS gap. No profiler timings are used in these screens.

The next bounded experiment should fuse a proven-safe first assignment
into its declaration, or directly return eligible leaf expressions, while
preserving coercions, evaluation order and exceptions. Check actual bytecode
before a project benchmark. The larger representation gap remains module
lexical state in native TS versus instance fields and method dispatch in the
Dafny runtime. A generic storage change requires an explicit lifetime and
reentrancy contract; it is not justified by syntax alone.

## Correctness and build gates

Node25 gates passed: typecheck, 59 Vitest tests, 548 parser unit tests, 220
stringify tests, reproducible generation, the unchanged seven-file output
guard, 20 guard/shape tests and 19 generated-runtime tests. The candidate
engine has exactly 27 declaration-line changes; project source digest and
shape policy are unchanged. Stock source generation also reproduced the
checked-in engine byte for byte.

The final exact pinned cache Release build passed with zero reported warnings
or errors in 25.18 seconds. Its actual compiler translated the generic
fixture, whose stock/candidate runtime outputs agree, and reproduced the
tested project candidate byte for byte. Three focused js-native LIT tests
passed at the preceding executable-identical source checkpoint; the final
source amendment changes only comments/documentation. Guarded generated-code
mutations disable a positive elision and incorrectly elide nested output-read
defaults; both fail, the latter on a behavioral difference. These are
regression checks, not a compiler correctness proof. Positive fixture
coverage uses the false default; broader accepted literals also appear in
the tested project output.

Node25 focused rebuild tooling passed six tests in both direct and test-runner
modes. Earlier source artifacts were stale and one cache restore retry failed;
those runs are superseded by the fresh pinned build and actual translation
checks above. No complete upstream backend matrix, parser proof or long
acceptance benchmark was run for this opt-in increment.

## Provenance

- Upstream Dafny v4.11.0: `fcb2042d6d043a2634f0854338c08feeaaaf4ae2`.
- Final source checkpoint: `1fafb597a2a9519ac653d3351e1f80f248846070`.
- Patch 1 unchanged: `48aa47d0918d0fb37b3557528b77b951f781debbab79ee7f1d86956507e02d33`.
- Maintained patch 2 is the single final net diff from source9fceae8 to1fafb597:
  `4bd8f6a77e4b4a67848e397fc5c7069f7ccdd7650d909725b9e4d97c9d1ba91f`.
- [Fresh final compiler provenance](output-initializers-compiler-provenance.json)
  records source diff, ordered patches, runtime jar and actual built assemblies.
- Dafny runtime control: `4bd2dc51631b1076bdaede2647120bf7b7a22033`.
- Candidate project base: `5a03835d9ca0567f87c62951c64ce8b287eaf3c0`,
  with only the temporary generated-engine overlay.
- Candidate engine SHA-256: `6de58472d3d4375745c4e38ac50ba4eeb74a0f9b1095537753a8c70d87e07f5a`.
- Project source digest: `64a7358f7d4b6b3f966da4cf0965cad06f5d25b43b6957284172f5945327286b`.
- Both screens use Node25.9.0, the same dependencies and fixture bytes, three
  alternating pairs, nine CPU cases, four fresh-process memory cases and
  25 memory calls per case. Source fingerprints were unchanged during each
  screen; all selected samples are present and errors are empty.

Builds, profiling and correctness checks ran outside the quiet timed screens.
The modified emitter remains part of the trusted computing base; source
proofs alone do not validate its generated JavaScript.
