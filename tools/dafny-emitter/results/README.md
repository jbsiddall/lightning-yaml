# Emitter measurements

- [Output initializer experiment](output-initializers.md): second round,
  with isolated Dafny and current-main comparisons, complete raw samples and
  a bytecode check that found no initial-write removal in its boolean fixture.
- [First arrayPush screen](#first-arraypush-screen): initial annotated workload.

## First arrayPush screen

The first official-emitter experiment remains opt-in. It did not show a
consistent CPU improvement. This screen compares the previous **Dafny** build
at `4bd2dc51631b1076bdaede2647120bf7b7a22033` with the annotated `js-native`
candidate, rather than the original TypeScript implementation.

Node 25.9.0 completed three alternating pairs across nine CPU and four cold
memory cases in 46.97 seconds of external wall time. The supervisor recorded
46.509 seconds, all selected samples, and no errors. Source and fixture
fingerprints stayed unchanged during measurement.
<!-- bench:a2ce4a67ca2b2fbeff17b19e4e67bfda4433199f388c383937a5e52c95358650 ly:4bd2dc51631b1076bdaede2647120bf7b7a22033 emitter:fcb2042d6d043a2634f0854338c08feeaaaf4ae2 patch:48aa47d0918d0fb37b3557528b77b951f781debbab79ee7f1d86956507e02d33 -->

| CPU case | Median change | Pair range |
|---|---:|---:|
| Parse medium records | +3.8% | −6.2% to +6.0% |
| Stringify medium records | +9.3% | −4.5% to +11.6% |
| Parse plain medium records | +9.3% | +0.5% to +9.8% |
| Stringify plain medium records | +6.8% | −7.9% to +13.7% |
| Parse rich medium | +17.4% | −1.3% to +24.3% |
| Stringify rich medium | −5.9% | −15.7% to +5.4% |
| Parse options | +6.4% | +4.6% to +17.7% |
| Parse escaped long quotes | −3.8% | −5.9% to +5.3% |
| Parse unescaped long quotes | +8.3% | +4.6% to +12.4% |

| Memory case | RSS change | Retained heap change | Heap difference |
|---|---:|---:|---:|
| Parse small records | +0.1% | +3.4% | +5,872 bytes |
| Parse rich small | +0.0% | +1.2% | +4,384 bytes |
| Stringify rich small | +0.5% | −4.5% | −4,952 bytes |
| Stringify rich medium | −0.6% | −26.2% | −21,896 bytes |

Positive CPU changes mean slower execution. Retained heap includes compiled
code and engine feedback as well as objects. These estimates do not establish
the full 15% replacement target.

Generated output contains 46 staged pushes; 17 previously retained wrapper
calls disappeared. The existing postpass had already inlined the other 29
sites. Staging adds two locals per site. Investigating staging at those already
inlined sites is a possible next experiment; this screen does not establish
the cause of the CPU changes.

The candidate passed reproducible generation, generated output guards,
548 unit tests, 220 stringify tests, type checking, and 59 Vitest tests.
Compiler build and the two focused upstream fixtures also passed. These gates
cover this experiment, rather than complete parser proofs or every upstream
compiler target.

## Provenance

- Upstream: Dafny `v4.11.0`, `fcb2042d6d043a2634f0854338c08feeaaaf4ae2`.
- Compiler patch SHA-256: `48aa47d0918d0fb37b3557528b77b951f781debbab79ee7f1d86956507e02d33`.
- Candidate uses the separate workload annotation, regenerated engine,
  reviewed shape inventory, and explicit guard entries for the emitted pushes.
- [Raw screen](array-push-node25.json), SHA-256:
  `a2ce4a67ca2b2fbeff17b19e4e67bfda4433199f388c383937a5e52c95358650`.

Builds and correctness checks ran outside the performance screen. No long
acceptance benchmark was started.
