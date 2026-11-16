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
<!-- yaml:2.9.0 ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

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
conclusion. Their mechanics are covered with injected fake operations; no real
provider timing campaign was run for this contract change.
<!-- yaml:2.9.0 ly:d1c55cfbc89cc11c0d2267d44b18f8bcec459ce7 -->

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
the artifact basename. `graph-census` does not accept `--artifact`. Snapshot
chunks use a synchronous file sink so writes apply backpressure directly to
Inspector event delivery. Sink refusal or write errors return an incomplete
status and remove partial files.

The diagnostic campaign clock starts at CLI entry and allows at most 60 seconds
overall; its worker has a separate 49-second inner limit, clamped to the
remaining outer time after participant and fixture preparation.
Diagnostics are not scored observations and establish no performance result.
No profile or heap snapshot was collected for this harness change.

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
<!-- yaml:2.9.0 yaml:2.8.3 server:4bf9c818850bf9751696d24848fdeaececb4203c ly:98695e5ed59400ae31b9e4db710b7fa3cce0f1d4 -->
