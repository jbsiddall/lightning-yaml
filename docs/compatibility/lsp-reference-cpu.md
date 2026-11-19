# Reference server CPU diagnostic

The separate `scripts/compatibility/bench-lsp-reference-cpu.mjs` collector
implements the [frozen next experiment](reports/2026-11-18/lsp-cpu-next-experiment.md).
The historical diagnostic modes and their outputs retain their existing protocol.
This collector changes no parser or server code.

The maintainer must independently review the exact source ownership manifest and
launch identity before capture. The manifest is private JSON using
`lsp-exact-source-ownership-v1`: physical module paths and SHA256 digests, exact
V8 function name/zero-based definition line/column/category tuples, and exact
`runProfiledOperation`/`runProfiledBatch` boundaries. Unknown locations remain
unknown. Custom-tag setup and helpers have categories separate from actual
resolver callback execution.

Prepare a plan after committing the producer checkout, using the pinned runtime:

```sh
node scripts/compatibility/bench-lsp-reference-cpu.mjs --plan \
  --manifest /private/source-ownership.json --output /private/plan.json
```

This command hashes inputs and validates identities without starting Inspector.
It binds the manifest digest, exact physical stock reference closure, compiled
server closure and external modules, corpus, producer HEAD/tree and runtime.
The closure policy hashes sorted absolute-path/SHA256 pairs; moving an otherwise
identical provider changes its identity. Physical module paths must match the
frozen source manifest and launch plan.

After independent review and a separate launch guard, run exactly once:

```sh
timeout --signal=KILL 65s node scripts/compatibility/bench-lsp-reference-cpu.mjs \
  --run --plan /private/plan.json --plan-sha256 PLAN_FILE_SHA256 \
  --storage /private/fresh-artifacts --output /private/campaign.json
```

The artifact directory must already exist outside the repository. The report,
numbered profile artifacts and numbered receipts must be fresh paths. The first
report write is exclusive; later ledger transitions replace it atomically.
The report starts incomplete with every scheduled case pending. Preparation or
child failure preserves the first failure and remaining pending cases. External
termination can leave a running row; it remains an incomplete attempt and must
be disclosed by the external guard. There are no retries or replacement inputs.
The guard uses the frozen limit, leaving finalization time beyond the CLI budget;
the earlier memory diagnostic's different guard does not change this protocol.

Each child hashes its physical inputs before sampling, runs the actual existing
server adapter with caller TextDocument absent, then validates the final graph,
ordinary options and effective custom tags after stopping Inspector. It keeps
only the latest result, with ordinary server cache behavior. Loop monotonic wall
and process CPU snapshots have a recorded order and remain separate from
Inspector clocks. Process CPU includes all process threads.

Receipts contain artifact digests, safe scalars and redacted frame/module paths;
raw profiles stay private. Exclusive leaf assignment, nearest-owned ancestry and
inclusive membership are separate. First framing and trailing residual are
separate from operation observations. Interval estimates are labeled estimates,
not exact CPU shares. Coverage uses exact owned operation leaf observations over
all post-framing observations, including detached runtime/GC and unknown work.
Both sample screens must pass for each child; inadequacy stops the campaign.
A complete campaign reports both repeats and permits inspection of their
agreement. It makes no optimization, candidate eligibility or universal CPU
ceiling claim.
