# Next reference CPU attribution experiment — frozen, unrun

This specification is for the maintainer implementing a later collector change.
It repairs representative reference coverage and operation boundaries; it does
not authorize candidate integration or establish an optimization result. No code
or capture of this experiment is included in the historical audit PR.

## Fixed identity and schedule

Use the existing actual server at
4bf9c818850bf9751696d24848fdeaececb4203c with physical stock yaml 2.9.0,
entry SHA256 2d58984e0ae80de4acbd8f009fab332f5ce77d9e1a5f138a3058a0ada6567fb9,
and reference closure SHA256
2dd772e1e6839d90159c0fa900247b2d9854766c4d17f8953eb704110c03b217.
Preserve ordinary YAML 1.2 options/TAG_SETTINGS, retained source tokens,
conversion and literal uniqueKeys=true; caller TextDocument remains absent.
Keep the full server compiled-closure and fixture pins from the
[historical audit](lsp-cpu-audit.json) and corpus manifest. Hash all physical
inputs before launch and include them in each child receipt. Fail a changed
identity; do not substitute providers or override policy.
<!-- yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c -->

Launch six fresh serial reference-only children in this fixed order:

1. docker-compose-pihole-cloudflared-doh
2. kubernetes-zookeeper
3. github-actions-cmake-multi-platform
4. github-actions-cmake-multi-platform
5. kubernetes-zookeeper
6. docker-compose-pihole-cloudflared-doh

Use original complete streams, never derived scale copies. Each child discards
three ordinary warmups, requests 1000 us sampling before start and runs exactly
1000 operations. No adaptive iterations, extra repeats, retries or forced GC.
These fixed choices are experimental design, not measured feasibility.


Pinned originals (bytes, SHA256), from the [corpus manifest](../../../../test/corpus/real-world/manifest.json):

- kubernetes-zookeeper: 2903, f8ee35065a386477e8435a64cecc2a5fd9e89e708666426be8d8760e7efdd529
- docker-compose-pihole-cloudflared-doh: 1608, 1d21b87c152f756a760df9029fe1d303d3c2fad00b4ca277439490ac77e7a857
- github-actions-cmake-multi-platform: 3356, 251f58c701753102802d0cb9a45f217d68ee1599475dcce1114641f3b42eacc0
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c -->

## Concrete operation and clock boundaries

Prepare modules, resolver hooks, physical hashes, source and options before
sampling. A stable named `runProfiledBatch` calls a stable named
`runProfiledOperation` exactly once per complete server parse. Keep the latest
result live by replacing one holder after each return, with unchanged server
cache behavior; do not retain the batch outputs. The wrappers must be ordinary
synchronous functions with sampled identities recorded in the source manifest.

After Inspector start resolves, record process.hrtime.bigint() and
process.cpuUsage() immediately before the loop. Run the fixed batch; immediately
after the loop, snapshot process.cpuUsage() and process.hrtime.bigint(), then
stop Inspector. Record the actual snapshot order and completed operation count;
report any thrown operation and stop. Validate the last complete graph,
provider/options/duplicate policy identities and document count only after
stop, then serialize artifacts/receipts outside the repository.

Report monotonic loop wall duration, user/system process CPU deltas, snapshot
order and Inspector start/end/delta clock separately. Process CPU includes all
process threads; wall includes scheduling and sampling overhead. Do not assume
Inspector and monotonic clocks share an epoch without pinned implementation
proof or explicit calibration. No inferred per-operation timestamps. First
Inspector framing interval, trailing unobserved gap and operation-boundary stack
membership remain separate. Runtime/GC, Inspector/harness, other known work and
unknown ancestry must remain disclosed; detached GC is never assigned by time
proximity. Instrumentation adds overhead and does not reproduce editor lifecycle.

## Source ownership, validation and repeat guards

Before capture, freeze a versioned exact-source-function manifest bound to
physical source/module hashes and function name, source location and module
identity. Inspect source and real call paths for lexer/parser, composer,
built-in scalar/tag resolution, actual custom-tag resolver callbacks, server AST
conversion and server wrappers. Distinguish tag setup/helpers from resolver
callback execution. A filename regex or arbitrary function with `resolve` in
its name is insufficient. Bundled source mapping needs audited exact mappings;
unmapped locations remain unknown. Independently review this manifest before
running, and fail an identity mismatch rather than infer ownership.

The offline audit helper may validate digest, tree/sample references, acyclicity,
paired finite nonnegative deltas and span/residual reconciliation. Extend it
only as reviewed for new receipts. Emit exclusive leaf/nearest-owned assignment
and inclusive ancestry membership separately. Counts must sum where exclusive;
inclusive rows overlap. Publish counts and explicitly labeled interval-weighted
estimates, with first framing and tail separate. Neither is exact CPU share.
Preserve raw profiles privately and public receipts with hashes and safe scalars.

Each case needs at least 200 operation-attributable useful samples and at least
80% independently justified classified coverage, reported with explicit
numerator/denominator. These are necessary screens, not confidence intervals or
proof of semantic attribution. Compare both repeats per shape, disclosing
category counts, interval proxies, unknown/framing and clock differences. Only
mechanisms present with consistent ownership and concentration across both
repeats may guide an optimization hypothesis; disagreement, inadequate samples,
ambiguous mapping or large unexplained runtime/unknown work stays inconclusive.
No hidden numeric agreement cutoff or selective exclusion: publish both and
justify any claimed agreement explicitly before proposing optimization work.

## Budgets, ledger and stopping

Freeze the full schedule, identities, classifier manifest digest and launch plan
before running. Keep a 60 s CLI outer budget including setup, shared 49 s inner
budget across all six children, and clamp each child timeout to remaining outer
and inner time. Declare a separate 65 s external process guard before launch;
its termination is an incomplete campaign, never success. Start the inner clock
at the declared first child launch and never reset it. These are fixed limits,
not a promise that all cases fit.

Prepopulate a ledger with all six case IDs and pending states; update each
transition through running to completed or failed/incomplete, recording timeout,
signal, completed operations, cleanup state and receipt/artifact hashes. First
failure, identity/graph/clock validation failure, budget exhaustion or external
termination stops further launches. Preserve all remaining pending IDs and the
first failure; no retry or replacement shape. Sampling inadequacy also makes
the affected case inconclusive and stops the campaign rather than topping up.
Only a complete ledger with all receipts valid permits a campaign-level claim.

Repeatable representative reference concentration in a specific audited
mechanism, small disclosed unknown/framing contributions and a concrete
semantics-preserving way to reduce that work can motivate a later optimization
experiment. Shape/repeat disagreement, unresolved runtime/GC or clock scope,
insufficient samples or budget failure argues for resolving evidence first.
Neither outcome establishes a universal CPU ceiling. Candidate comparison,
source integration and P1 still require their separate compatibility, memory
and lifecycle gates. P2 and the 10–100× goal are unchanged.
