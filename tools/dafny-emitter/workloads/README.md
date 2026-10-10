# Workload overlays

`lightning-array-push.patch` annotates the existing `Native.ArrayPush` extern
with the generic `jsIntrinsic` contract so the Dafny emitter can exercise it.
It is a project workload input, not part of the Dafny compiler patch series in
`../upstream.json`, and setup never applies it automatically.

Apply it only in an isolated project worktree after building the compiler
candidate and checking the patch against the workload's current source:

```sh
git apply --check tools/dafny-emitter/workloads/lightning-array-push.patch
git apply tools/dafny-emitter/workloads/lightning-array-push.patch
```

Then regenerate through stock and candidate compilers, inspect the output and
update the generated-shape guard only for the reviewed intrinsic sites. Do not
change the default generation route as part of this experiment.
