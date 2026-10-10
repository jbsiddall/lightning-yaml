# Pinned Dafny emitter experiment

This is an opt-in experiment based on the official Dafny compiler at
`v4.11.0` (`fcb2042d6d043a2634f0854338c08feeaaaf4ae2`). The upstream tree is
not vendored. `upstream.json` pins each ordered patch by path and SHA-256;
patches are kept here and applied only to the candidate worktree. Their
four-digit prefixes must form a contiguous series beginning at `0001`.
Stock and candidate each get their own detached worktree and build outputs.

## Build and translate

Choose a fresh, isolated writable cache directory. The setup command is the
only command that clones upstream. Build commands restore and compile the
selected profile; translation runs the actual compiler CLI. A runtime jar can
be supplied for environments without Java, and is copied into that profile's
cache worktree with its SHA-256 included in provenance.

```sh
node tools/dafny-emitter/emitter.cjs setup --cache /tmp/dafny-emitter-cache
node tools/dafny-emitter/emitter.cjs build --cache /tmp/dafny-emitter-cache --profile stock
node tools/dafny-emitter/emitter.cjs build --cache /tmp/dafny-emitter-cache --profile candidate
node tools/dafny-emitter/emitter.cjs translate --cache /tmp/dafny-emitter-cache --profile stock -- --no-verify --include-runtime --output /tmp/Stock.js input.dfy
node tools/dafny-emitter/emitter.cjs translate --cache /tmp/dafny-emitter-cache --profile candidate -- --no-verify --include-runtime --output /tmp/Candidate.js input.dfy
node tools/dafny-emitter/emitter.cjs provenance --cache /tmp/dafny-emitter-cache
pnpm dafny:emitter:test
```

Set `DOTNET` to choose the SDK executable. `--runtime-jar PATH` is optional
for `setup` and `build`. The target remains opt-in: normal `dafny:generate`
continues to use the installed pinned Dafny compiler. The candidate enables
the separate experimental `js-native` target. Stock translation continues to
use `js`. Translate the same fixtures through both profiles and compare runtime
behavior before using the candidate on project sources.

Run the tooling checks with `pnpm dafny:emitter:test`. From the candidate
compiler worktree, run its focused upstream LIT fixture with:

```sh
dotnet test Source/IntegrationTests --filter 'DisplayName~IntrinsicArrayPush' --logger 'console;verbosity=normal'
dotnet test Source/IntegrationTests --filter 'DisplayName~OutputInitialization' --logger 'console;verbosity=normal'
```

After applying the optional project overlay and generating the project outputs,
run `pnpm dafny:check` for the generated shape guard and runtime regression
suite.

The experimental compiler backend is part of the trusted computing base.
Existing Dafny proofs establish properties of source programs; they do not
prove that modified code generation preserves those properties. Treat the
candidate as untrusted until stock differential fixtures and project semantic
checks pass.

## Native intrinsic contract

The first intrinsic is `{:jsIntrinsic "arrayPush"}` on a static extern method
with two non-ghost inputs, no outputs, and no method or enclosing class type
parameters. It asserts that the host binding is immutable, its lookup has no
observable effects, and its body performs `receiver.push(value)` with the
result discarded. Dafny does not verify that assertion about the host body.

The emitter evaluates both arguments once, in order, before looking up `push`.
Dynamic getters, proxies, overrides, method `this`, and thrown payloads remain
observable. Removing the wrapper changes caller stacks; engine-generated
TypeError wording for invalid receivers may also differ. This is an explicit
host contract, rather than an unconditional optimization for arbitrary extern
methods.

## Benchmark gate

Use the repository's alternating quick benchmark screen, capped at 60 seconds
per iteration, for initial directional evidence. Keep Node version and inputs
fixed, and include rich stringify, a quoted-string path, and small cold-memory
samples. Inspect generated JavaScript to confirm the intended call shape
changed. A quick-screen result is not full acceptance evidence; reserve the
full benchmark suite for a promising candidate and an explicit adoption
decision. Once both profiles are integrated into isolated project roots, run
`pnpm bench:quick BASELINE_ROOT CANDIDATE_ROOT [OUTPUT.json]`. Compiler
restore/build and correctness fixtures are separate from the timed performance
screen.

The optional lightning-yaml annotation used to exercise the intrinsic lives in
[`workloads/lightning-array-push.patch`](workloads/lightning-array-push.patch).
It is a separate, manually reviewed project overlay and is never applied by
compiler setup.

The [first measured screen](results/README.md) records mixed results and its
raw samples. The [output initializer experiment](results/output-initializers.md)
adds a conservative default-false code-generation hook, enabled only for
`js-native`. It omits a pure literal default only when the first physical
statement assigns the single output without reading it. Other shapes retain
stock initialization. The original assignment lowering is preserved.

This second round changes 27 generated declarations. Its focused Node25
bytecode check still contains the implicit `undefined` initialization and
shows no bytecode or frame-size reduction. Two capped screens found no
consistent CPU/memory improvement; the current TypeScript comparison still
misses the replacement target. The candidate remains experimental.
