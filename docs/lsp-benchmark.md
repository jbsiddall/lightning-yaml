# YAML language-server parser contract

This harness describes one concrete consumer path: `yaml-language-server`'s
compiled `yamlParser07.parse()` path. The server keeps the parser's CST tokens,
composes `Document` instances, converts each document to the server AST, and
uses a line counter for diagnostics. The harness checks those objects and their
source links; it does not substitute a hand-written AST converter or call a
`toJS()` proxy in place of the server.

## Checks

Run the dependency-free stock-provider contract check with:

```sh
pnpm bench:lsp -- --check --self-check
```

This is a contract self-check against pinned `yaml@2.9.0`. It validates the
fixtures and semantic assertions, checks a built main YAML compatibility entry
when one is present, and sets `candidateCompatibility: false`. The ordinary
test suite also asserts directly that the main source shim lacks the
`Composer`/`Document` API required by this server path. This is not evidence
that a candidate is compatible and does not report timings.
<!-- yaml:2.9.0 ly:183287b0af74629615fbd6234575a0b1c7a176b5 -->

To exercise the real compiled server with both providers, pass explicit clean
checkouts and built artifact entry points:

```sh
pnpm bench:lsp -- --check \
  --candidate-root /path/to/candidate-checkout \
  --candidate-entry /path/to/candidate-checkout/dist/yaml-compat.js \
  --candidate-head <reviewed-candidate-commit> \
  --server-root /path/to/yaml-language-server \
  --server-head <reviewed-server-commit>
```

The server's source and dependencies are not edited. A fresh child process
registers a Node resolver before loading the server and maps only the bare
`yaml` import to the explicit provider file. It rejects `yaml/*` imports,
records each importing server module and destination, and checks that imports
stay inside the selected compiled server tree. Node must support synchronous
`node:module.registerHooks` for this actual-server check; the bare self-check
does not require that capability.

The result keeps the server's declared `yaml` dependency version (`2.8.3`) separate
from the injected provider's package version and artifact hashes. Provider
Documents and nodes are checked against that exact imported namespace, and
server AST nodes must point back to those same provider nodes. Build artifact
hashes identify the files that ran; they do not prove that ignored build output
was produced from a particular source tree.
<!-- yaml:2.8.3 yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

## Contract coverage

The corpus pins three unmodified, licensed files in the existing real-world
fixture manifest: Compose, Kubernetes ZooKeeper, and GitHub Actions CMake.
Each file and its separate license file is checked against the recorded byte
count and SHA-256. Derived streams repeat complete CMake documents with a
five-byte `\n---\n` separator. Thirty copies are 100,825 bytes; 312 copies are
1,048,627 bytes. These are scaled document-count inputs, not claims about the
size or document count of the upstream originals.
<!-- ly:5147c874308655cb19923222c108d4fe7253144a -->

Semantic controls cover CRLF and non-BMP UTF-16 offsets, line callbacks with
and without a `TextDocument`, trailing empty and whitespace-only lines,
including a final line ending in a standalone carriage return,
comments, custom tags and their return-type metadata, aliases, duplicate-key
policies, malformed-document recovery, clone/edit behavior, structured-cloned
CST tokens, and root block scalar indentation. CST reconstruction checks the
original source, while AST values and token identity are asserted separately so
unchanged source tokens cannot conceal a corrupted semantic value.

The root `|2` control is the scalar document `|2\n  hello\n`. Stock `yaml@2.9.0`
composes `hello\n`; the candidate composes ` hello\n` in the direct Composer,
the LSP's internal `Document`, and the server AST. This is an explicit
provider-specific status row. The context-free `CST.resolveAsScalar()` helper
does not know whether a scalar is at the document root, so its result is not
used as the Composer or server oracle.
<!-- yaml:2.9.0 ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

The server does not pass a `uniqueKeys` override. Its actual literal defaults
are recorded separately: stock `yaml` uses `true`, while the candidate uses
`false`. Those consumer rows are status-only and cannot support a joint
performance claim. Bare Composer policy controls cover literal defaults,
explicit `false`, explicit `true`, and a traced comparator; they do not change
the server's options.
<!-- yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

The actual-server check also records the duplicate witness's real `Document`
diagnostics and converted value. For the fixed input `a: 1\na: 2\n`, stock
`yaml@2.9.0` reports one `DUPLICATE_KEY` at `[5,6]` and converts to `{a: 2}`;
the candidate's literal default reports no composition error and converts to
the same value. The receipt checks the observed policy flag, diagnostic and
value independently. This is evidence for that witness only, and the literal
consumer rows remain status-only: the server's supported parser options are
`customTags` and `yamlVersion`, and its Composer construction does not forward
`uniqueKeys`. The explicit matched-policy bare-provider results are not a
substitute for this server operation.
<!-- yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

### P0c outcome and remaining acceptance

The pinned unchanged server operation is behaviorally incompatible on the
duplicate-key diagnostic witness, despite converting to the same last-wins
value. This receipt makes the incompatibility observable; it does not promote
the literal rows into performance comparisons or complete P0. P1 remains
unready. Any future actual-consumer comparison needs a supported way to obtain
the same duplicate diagnostic behavior on both providers, plus the remaining
representative server attribution and verified mandatory-output memory floor.
The fixed witness does not establish universal duplicate-key or YAML
equivalence, and this result does not authorize a provider-default or API
change. The separate [P0b report in PR #325](https://github.com/jbsiddall/lightning-yaml/pull/325)
retains the earlier execution-unknown failed launch, the incomplete 312-document
run, the unknown mandatory-byte floor, and declared measurement cells that were
not run. Caller `TextDocument` inputs and post-drop cache lifetime are separate
unmeasured consumer scenarios, not declared diagnostics. P0c does not resolve
or replace those limitations.
<!-- yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

### P0d true-policy baseline

The predeclared matched-policy campaigns completed for the three original YAML
streams and a separate 30-document derived GitHub Actions stream with the explicit
`uniqueKeys: true` policy. CPU and retained-heap factors stayed near
parity; none shows the joint 10× gain. This is a bare-library baseline only:
the unchanged server still uses literal defaults with different duplicate-key
diagnostics, and actual-consumer performance remains ineligible. The 312-document
true-policy cell was not run. P0 remains incomplete and P1 unready. See the
[2026-11-17 report](compatibility/reports/2026-11-17/lsp.md) and its
[compact observation export](compatibility/reports/2026-11-17/lsp-observations.json)
for paired factors, all 48 observations, run integrity and limits.
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:b849a0053a98f079fd5f3771b38648a4c4f72f41 data:d3ea10ddf4da888cca38898c1d1b67771164dbcf390cba7e05b2abab5e2f3493 -->

## Measurement runs

`--plan` validates participants and prints the selected pending cells without
running parser operations. `--measure` runs the selected cells. Both modes
require explicit distinct candidate and server checkouts, validate both
providers' Composer APIs, and reject a missing external Composer instead of
falling back to the main shim or server's installed alias.

Review a selected batch before starting its phases by using the same explicit
participants with `--plan`:

```sh
pnpm bench:lsp -- --plan \
  --candidate-root /path/to/candidate-checkout \
  --candidate-entry /path/to/candidate-checkout/dist/yaml-compat.js \
  --candidate-head <reviewed-candidate-commit> \
  --server-root /path/to/yaml-language-server \
  --server-head <reviewed-server-commit> \
  --batch bare-corpus
```

Switch `--plan` to `--measure` to execute the selected cells. Use `--cells` to
limit a named batch; cells omitted from that selection stay visible as
`notSelected`.

Named batches are `bare-corpus`, `bare-scale`, `bare-matched-corpus`,
`bare-matched-scale`, `bare-policy`, and `lsp-consumer`. They contain 3, 2, 6,
4, 6, and 12 logical comparison cells, respectively. The matched batches
declare both explicit `uniqueKeys: false` and `uniqueKeys: true` policies. A
cell ID is provider-independent and identifies its batch,
fixture, declared policy, and document mode. `--cells` selects logical cell IDs
from the named batch, so selecting one case still schedules its candidate and
reference pair.

Every selected cell uses two declared paired repeats. The first repeat follows
the batch's cell order and runs candidate then reference for each phase; the
second reverses the cell order and runs reference then candidate. Each scored
phase worker has a unique observation ID containing its cell, repeat, participant,
and phase. Semantic-preflight workers use separate check IDs outside this paired
schedule. `--plan` prints the scored schedule. The full batches declare 36,
24, 72, 48, 72, and 144 phase observations respectively; selecting one cell declares
12. Results retain planned, selected, completed, failed, pending, and
not-selected observation IDs as well as the logical cell ledger.

Each participant/cell/repeat/phase runs in a fresh sequential worker. The
CPU/wall phase performs three warmups and 25 measured operations; output
checksums are computed after the timed loop. The retained-heap phase retains
all 25 complete results, collects garbage before and after, and reports the
heap delta. The isolated peak-RSS phase performs one operation in a fresh
process and reports the process high-water mark alongside before/after RSS.
Import/startup time is recorded separately. The 60-second outer campaign clock starts at CLI entry and
includes provider loading, fixture preparation, and semantic preflight children.
After preflight, scored workers share a 49-second inner budget clamped to the
remaining outer time. Incomplete identities stay failed or pending in the
ledger. Matched-policy cells enter scored phases only when candidate and
reference semantic preflight agree on document values and types, alias
reference identity, ranges, diagnostics, and line starts. A mismatch keeps both
preflight outcomes and marks that cell failed and performance-ineligible.
These phases report raw observations and do not make an optimization
conclusion. Their mechanics are covered with injected fake operations. The first
real `--measure` CLI launch failed in report finalization because
`preflightComplete` was out of scope, and emitted no usable measurement report.
Whether any scheduled phase worker executed is unknown; treat this launch as
unscored and do not use it as performance evidence. The failure is tracked in
[#326](https://github.com/jbsiddall/lightning-yaml/issues/326). A separately
reviewed recovery later completed the three original explicit-false cells;
the 30-document derived cell completed, and the 312-document derived cell
timed out with phases pending. See the [dated report](compatibility/reports/2026-11-16/lsp.md)
for exact factors and execution status. The recovery is a distinct attempt and
does not replace or backdate the failed launch.
<!-- yaml:2.9.0 ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c data:883aaeb39b9196e3345146e82534951278e1b67d9a24179bd29ad13cebdcc19c -->

## Non-scored diagnostics

`--diagnose` runs one bounded diagnostic child through the same provider import,
resolver hook, and parser operation used by measurement workers. It requires the
reviewed candidate and server roots/heads, a corpus fixture, and an explicit
participant (`candidate`, `reference`, `server-candidate`, or `server-reference`).
The default bare policy is `uniqueKeys-false`; actual-server runs preserve the
server's literal defaults. `--diagnostic graph-census` is limited to all three
original fixtures through each actual-server provider (six distinct cases). It
reports own-property reachable graph counts, selected string-field occurrences,
and their code units without invoking accessors. Those string counts describe
property occurrences, not unique physical string storage, and are never bytes.
The census skips own `schema` reference edges and separately reports their field
occurrences, per-owner graph-local identity links, and distinct schema
identities. This makes per-document references and schema reuse visible without
including schema contents in the operation graph counts; schemas may be
per-document or shared. These graph-local IDs are not V8 heap-node IDs. This is a
partial graph census: excluded schema memory remains unknown, so these counts
do not establish a complete retained graph or a byte floor. Prototype and
module roots are not traversed, and the alias-resolution cache is reported as
an untraversed root that may retain the latest AST. `--diagnostic cpu-profile` is limited to
the declared GitHub Actions bare matched-false and actual-server cases; it uses
three warmups, 250 operations, and a 1 ms sample interval. `--diagnostic
heap-snapshot` is limited to actual-server GitHub Actions cases and captures a
raw snapshot for offline inspection; the harness does not parse snapshots or
infer object bytes from counts. Server-wrapper frames are distinct from the
actual `ast-converter.js` conversion functions. A profile is insufficient for
fine attribution unless it has at least 200 useful samples and at least 80%
classified coverage; reports include total, useful, assigned, and unassigned
counts. Snapshot capture keeps the operation result
live, but emits no object-identity-to-heap-node mapping. Offline exact mapping is
required before attributing bytes or deriving a floor; if mapping is not
established, byte attribution and the floor remain unknown. CPU profiles and snapshots require a private
`--artifact` destination outside the repository; the JSON result reports only
the artifact basename. Existing parent symlinks are resolved before the
outside-repository check, and workers receive the canonical destination.
`graph-census` does not accept `--artifact`. Snapshot
chunks use a synchronous file sink so writes apply backpressure directly to
Inspector event delivery. Sink refusal or write errors return an incomplete
status with cleanup reported as removed, retained, or unknown. The report only
claims removal when the sink verifies it; the coordinator does not infer cleanup
from the final artifact path.

The diagnostic campaign clock starts at CLI entry and allows at most 60 seconds
overall; its worker has a separate 49-second inner limit, clamped to the
remaining outer time after participant and fixture preparation.
Diagnostics are not scored observations and establish no performance result.
The completed non-scored profile, census and snapshot observations, including
their coverage limits and unknown byte floor, are summarized in the
[2026-11-16 report](compatibility/reports/2026-11-16/lsp.md).

Example non-scored census invocation (use the reviewed roots and hashes above):

```sh
pnpm bench:lsp -- --diagnose --diagnostic graph-census \
  --participant server-candidate \
  --fixture github-actions-cmake-multi-platform \
  --candidate-root /path/to/candidate-checkout \
  --candidate-entry /path/to/candidate-checkout/dist/yaml-compat.js \
  --candidate-head <reviewed-candidate-commit> \
  --server-root /path/to/yaml-language-server \
  --server-head <reviewed-server-commit>
```

For a declared CPU profile or heap snapshot, add `--artifact` with a private
destination outside the repository. Each command runs one fresh diagnostic worker; repeated cases are
separate explicit invocations so their identities and raw files stay distinct.
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:fd10d8e1fa5cf89d09f7acf074ea603b2be0f707 -->

## Latest bounded evidence

The 2026-11-16 report records the two-repeat original corpus measurements, the
separate 30-document result, the incomplete 312-document run, and non-scored
diagnostics. It retains the failed first launch as execution-unknown and
unscored. The evidence does not establish same-behavior actual-server
performance or a mandatory-output byte floor. See the [report and compact
observations](compatibility/reports/2026-11-16/lsp.md).
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c data:883aaeb39b9196e3345146e82534951278e1b67d9a24179bd29ad13cebdcc19c -->

## Reference public-identity headers (P0e)

The opt-in `--diagnostic contract-header-budget` has its own fixed schedule:
Compose, ZooKeeper, GitHub Actions, then GitHub Actions, ZooKeeper, Compose.
`--plan` emits all six IDs as pending without importing either provider or
launching workers. `--diagnose` runs fresh children serially, only through
`server-reference`, retaining all selected, completed, failed and pending IDs.
It stops after the first failure and does not retry. An explicit `--output` is
reserved exclusively before any work; an existing file or symlink is rejected.
A killed process may leave an empty or partial reserved report, which remains
a retained launch artifact and cannot be overwritten by a rerun. No historical scored,
profile, census or snapshot count changes. A preparation/worker/postflight
failure produces an incomplete JSON report and exit status 1; an external
process kill can prevent that final write and must be retained as an unknown
launch alongside the predeclared pending plan.

Each child uses the existing retained-heap phase: prepare source/modules and
runtime evidence, discard three ordinary warmups, collect garbage and sample
heapUsed, retain 25 full streams, collect garbage and sample again. Graph
validation and inventory allocation happen after the second sample. The
TextDocument argument remains absent, custom tags and ordinary server options
remain present, and module/alias-cache state is untouched. Each retained
provider Document must expose effective `uniqueKeys: true`; the semantic
`--check` duplicate witness remains the separate evidence for literal policy.
The caller source is part of the baseline; editor state and post-drop cache
lifetime remain unmeasured. The entire CLI has a 60-second work budget and a
shared 49-second inner budget for the six serial jobs, clamped to remaining
outer time. The separately disclosed process guard is 70 seconds, including
startup/reporting. These counts are fixed before data, with no adaptive reruns.

The inventory is **current public-identity header accounting**, conditional on
the fixed eager mutable ordinary-object/array representation. Its allowlist is
independent of the old census. It admits returned result/document wrappers,
CST tokens and collection-item records, provider Documents/Nodes/Pairs and
items/ranges, and server AST nodes and their own properties/items arrays.
Known `_internalDocument` backing storage is read directly; getters, including
allocating `children` and diagnostic getters, are never invoked by the
inventory. `srcToken`, `internalNode` and parent links preserve actual sharing
and cycles. Identity IDs deduplicate over the union of all returned streams;
mutable clones remain distinct. Each entry records categories, reasons and up
to three representative own-data access paths. Trusted pinned prototypes and
required own paths are checked; a missing path fails the observation.

Schema/options/directives, arbitrary private fields, prototypes/module/cache
roots, diagnostic internals, custom object scalar payloads, string storage,
property tables and array backing stores stay excluded or unproved. Exclusion
does not establish that storage is unnecessary. An identity reached through an
admitted edge still counts if an excluded field also references it.

The diagnostic process verifies its actual executable version/hash, V8,
architecture, process configuration, argv, empty NODE_OPTIONS and installed
config/header hashes. Under the pinned uncompressed x64 representation,
24 bytes per ordinary object and 32 per array account only for headers. The
inference follows the pinned Node/V8 [tagged size and JSObject header](https://github.com/nodejs/node/blob/cdc1b38d40cb567b7ad0b39c86addf830a0af0ae/deps/v8/include/v8-internal.h),
[JSObject fields](https://github.com/nodejs/node/blob/cdc1b38d40cb567b7ad0b39c86addf830a0af0ae/deps/v8/src/objects/js-objects.tq)
and [JSArray length field](https://github.com/nodejs/node/blob/cdc1b38d40cb567b7ad0b39c86addf830a0af0ae/deps/v8/src/objects/js-array.tq).
Missing or mismatched runtime evidence yields null header-byte terms; host
assumptions are never substituted.
<!-- node:24.19.0 v8:13.6.233.17-node.51 source:cdc1b38d40cb567b7ad0b39c86addf830a0af0ae yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c -->

Reports retain signed before/after/delta heap values, union header totals,
per-stream terms and the observed budget divided by 10 and 100. A nonpositive
delta has no header/budget ratio. Post-GC heap delta is a noisy operational
budget, not output ownership or a rigorous upper bound. Even two observed
budgets cannot establish a statistical upper bound. These current identities
do not establish indispensability for lazy/proxy/rebuilt representations; the
genuine compatibility lower bound remains unknown. No universal reduction
ceiling, candidate result, eligibility or feasibility follows. Both repeats
must remain visible in any later comparison.

Plan-only example (no roots or worker launch needed):

```sh
pnpm bench:lsp -- --plan --diagnostic contract-header-budget \
  --participant server-reference
```

For a separately reviewed reproduction, change `--plan` to `--diagnose` and
supply the reviewed candidate/server roots and heads and physical stock
reference entry as in the existing diagnostic invocation. Saving a report with
`--output` requires a fresh destination; an existing file or symlink is rejected
before work begins. Do not supply `--fixture`, `--cells`, `--batch` or
`--artifact`: the schedule is fixed. Independent protocol review and an explicit
coordinator launch decision must precede any new data collection. The linked
[plan receipt](compatibility/reports/2026-11-18/lsp-header-budget-plan.json)
is the frozen prelaunch declaration for the completed run; its pending statuses
record the declaration state and contain no collected target diagnostics.

The approved reference-only campaign is now recorded in the
[2026-11-18 report](compatibility/reports/2026-11-18/lsp.md) and its
[compact observations](compatibility/reports/2026-11-18/lsp-header-budget-observations.json).
Both repeats exceed the observed one-tenth and one-hundredth heap budgets using
current public-identity headers under the fixed eager representation. The
genuine required-byte floor and universal implementation ceiling remain unknown.
<!-- yaml:2.9.0 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:75da749315dd019fc301055b4fd6962323d323db data:5aa4a636731e56230451e7bee117240807c5539dd56c7f8e36c316e2ca2b2212 -->

The [Nov 18 frozen CPU profile audit](compatibility/reports/2026-11-18/lsp-cpu-profiles.md)
reconstructs historical clocks and selected stacks without changing receipts or
classifications. Its [next reference experiment](compatibility/reports/2026-11-18/lsp-cpu-next-experiment.md)
is frozen and unrun; no candidate comparison or CPU ceiling follows from the old profiles.
