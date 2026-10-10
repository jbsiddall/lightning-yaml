# Pinned Dafny emitter experiment

This is an opt-in experiment based on the official Dafny compiler at
`v4.11.0` (`fcb2042d6d043a2634f0854338c08feeaaaf4ae2`). The upstream tree is
not vendored. `upstream.json` is the pin and ordered patch list; patches are
kept here and applied only to the candidate worktree. Stock and candidate each
get their own detached worktree and build outputs.

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
```

After applying the optional project overlay and generating the project outputs,
run `pnpm dafny:check` for the generated shape guard and runtime regression
suite.

The experimental compiler backend is part of the trusted computing base.
Existing Dafny proofs establish properties of source programs; they do not
prove that modified code generation preserves those properties. Treat the
candidate as untrusted until stock differential fixtures and project semantic
checks pass.

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
