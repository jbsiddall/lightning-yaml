# Frozen language-server CPU profile audit

This is an offline reconstruction for maintainers deciding what to measure next.
All four original Nov 16 GHA profile byte hashes match their receipts; receipt
hashes match the completed, unscored ledger. The
[redacted audit](lsp-cpu-audit.json) preserves artifact, receipt, ledger, fixture,
provider entry/closure, candidate, server and harness identities. It contains
normalized selected frames and scalars, never full raw trees. Existing reports,
receipts, classifier and collection modes are unchanged. No provider was run and
no new profile or timing was collected for this audit.
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c yaml:2.9.0 -->

<!-- data:5afbd026ac01c7e6cf888a20d89c5405ea7c9df2a156916cdf9df28ea034b718 ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c yaml:2.9.0 -->

## What was actually captured

There is one capture per participant of one original GHA stream, with no repeats,
Compose, ZooKeeper or scaled CPU cases. Each collector discarded three warmups,
requested a 1000 us sampling interval, then sampled 250 complete synchronous
operations, retaining only the latest result with ordinary cache/GC behavior.
Graph assertions and serialization followed Inspector stop. Warmups do not prove
steady JIT state.
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c -->

Bare operations materialized Parser token arrays and Composer document graphs
with strict=false, YAML 1.2, keepSourceTokens=true, empty custom tags and a
LineCounter; both explicitly selected uniqueKeys=false. Actual-server operations
called the compiled server parse with ordinary TAG_SETTINGS and returned server
AST/wrapper graphs, including conversion. They preserved differing literal
uniqueKeys defaults: stock reference true, candidate false. These actual-server
rows are ineligible matched-policy comparisons. Bare/server subtraction cannot
isolate conversion or callback overhead.
<!-- yaml:2.9.0 ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c server:4bf9c818850bf9751696d24848fdeaececb4203c candidate:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

Both historical server diagnostic callers used **absent TextDocument**. Immutable
[configuration at line 1345](https://github.com/jbsiddall/lightning-yaml/blob/eb4b3adcd5f3cf9a97a6f8430c468f84b652347c/scripts/compatibility/bench-lsp.mjs#L1345)
passes unchanged through diagnosticWorker to openMeasurementOperation, whose
absent branch supplies undefined to parse. The alternative supplied-document
branch was not selected. Module setup and the server's own work still occurred.
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c -->

## Clock reconstruction

The pinned official [Node/V8 Profiler protocol](https://github.com/nodejs/node/blob/cdc1b38d40cb567b7ad0b39c86addf830a0af0ae/deps/v8/include/js_protocol.pdl#L817)
defines samples as stack-top node IDs and timestamps/deltas in microseconds; the
first delta starts at profile startTime. These are Inspector elapsed intervals.
Assigning a delta to its observation is only an interval proxy, not exact
exclusive CPU execution. The profiled isolate also does not account for all
process threads.

| Participant | Samples | Profile span us | Delta sum us | First framing delta us | Trailing unassigned us | Node hitCount sum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | 233 | 280462 | 279750 | 20829 | 712 | 235 |
| reference | 273 | 329422 | 328712 | 23314 | 710 | 278 |
| server-candidate | 225 | 273611 | 272611 | 21617 | 1000 | 229 |
| server-reference | 268 | 322449 | 321567 | 25460 | 882 | 271 |
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c -->

All sample IDs and tree links are valid and deltas are positive and paired.
Every span equals first delta + subsequent deltas + trailing gap. First stacks
contain Inspector post/request/collector framing without operation ancestry;
one count hides a much larger elapsed framing interval. Trailing gaps have no
observation and remain unassigned. Intervals are unequal: observed min/max us
are 1045/20829, 1017/23314, 1003/21617 and 921/25460 in table order. Recount uses
sample arrays, not node hitCounts. There are no operation timestamps or separate
loop wall/process CPU brackets to align retrospectively to the Inspector clock.
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c -->

## Stack witnesses and category asymmetry

The export records exact function name, file basename, zero-based line and
column tuples selected from these hash-bound bytes. Tuples select only within
the pinned profile, not arbitrary future files with the same basename. Leaf
counts and inclusive ancestry counts are distinct; overlapping ancestry rows
must never be added. For historical categories, the helper reuses the unchanged
nearest-recognized-ancestor classifier, including its original regex order.
Their receipts reproduce exactly; their labels are not semantic CPU attribution.

- `operation` at bench-lsp.mjs:674:56 is the outer diagnostic operation boundary.
  Its ancestry covers 212/247/212/244 samples, respectively. Detached garbage
  collector leaves cover 20/23/12/22 samples and have only GC-to-root ancestry;
  proximity cannot attach them to any operation.
- Historical customCallbacks counts are 23/37/29/41, despite empty bare custom
  tags. Built-in resolveCollection, resolveBlockMap/Seq, resolveProps,
  resolveFlowCollection and resolveBlockScalar frames and their descendants
  enter that bucket. Reference foldLines at resolve-flow-scalar.js:75:18 has
  15/17 leaf samples in bare/server captures; the URL's `resolve` triggers the
  old label. Candidate bundle filenames hide that cue; candidate server
  foldLines inherits one resolver assignment. This demonstrates named,
  source-layout-dependent classifier asymmetry.
- Server parseCustomTag at customTags.js:13:30 has two samples in each server
  capture but lands in lexerParser because `parse` matches first. This is tag
  setup, as are getCustomTags/CommonTagImpl registration frames. Converter
  getCustomTagReturnType is a tag helper. Neither is established sampled user
  resolver callback execution. The export deliberately makes no user-callback
  category or zero-work inference.
- Converter tuples select convertAST/Map/Pair/Seq/Scalar/Alias in
  ast-converter.js. Historical nearest serverAst counts are 11/9; inclusive
  converter ancestry is 11/11. Reference descendants include a custom tag helper
  and composition work under different nearest labels. Server wrapper frames
  are separate from converter ownership.
<!-- ly:eb4b3adcd5f3cf9a97a6f8430c468f84b652347c yaml:2.9.0 -->

Bare reference additionally contains detached step/program observations; server
reference contains detached parsePlainScalar. Missing ancestry remains unknown,
not proof of work outside the operation. No explicit compiler/JIT frame was
identified; absent captured compiler or user callback frames cannot establish
absence of that work, including background work.

The old useful-sample and coverage thresholds passed as defined. That is useful
sample coverage, not semantic attribution validity. These profiles establish
parser/composer stack presence and real server conversion activity for this
shape. They do not establish representative concentration, a candidate advantage,
a fixed irreducible fraction, an Amdahl bound or any optimization decision.
Count shares and interval proxies alone provide no speedup ceiling. The
10–100× goal remains; P1/P2 stay conditional and #302/#105 do not move.

## Replay and next step

With the frozen private directory available, run:

```sh
node scripts/compatibility/verify-lsp-cpu-audit.mjs PRIVATE_DIRECTORY
pnpm exec vitest run test/compatibility/yaml/lsp-cpu-audit.test.ts
```

The verifier hashes ledger/declared plan before parsing, then receipts and raw
profiles before interpretation, validates graphs/clocks, reproduces every static
audit and verifies unchanged historical category receipts. It imports no
provider. Physical entry/closure digests are preserved from receipts; this audit
does not independently rehash every dependency closure file. The selected frame
manifest is evidence local to these captures, not a general profiler framework.
See the [frozen next-experiment specification](lsp-cpu-next-experiment.md), which
is **unrun** and requires a separately reviewed collector change. This PR adds
no capture implementation.
