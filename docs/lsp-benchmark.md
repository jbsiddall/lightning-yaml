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

The result keeps the server's declared `yaml` dependency (`2.8.3`) separate
from the injected provider's package version and artifact hashes. Provider
Documents and nodes are checked against that exact imported namespace, and
server AST nodes must point back to those same provider nodes. Build artifact
hashes identify the files that ran; they do not prove that ignored build output
was produced from a particular source tree.
<!-- yaml:2.9.0 ly:8ea0498b65b80806dfd67d1815b4faefcdede04e -->

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

Named batches are `bare-corpus`, `bare-scale`, `bare-policy`, and
`lsp-consumer`. Each cell is identified by batch, provider, fixture, declared
policy, and document mode. `--cells` selects only identities from the named
batch. Results retain planned, completed, failed, and pending identities; an
unrun cell stays pending.

Each participant/cell/phase runs in a fresh sequential worker. The CPU/wall
phase performs three warmups and 25 measured operations; output checksums are
computed after the timed loop. The retained-heap phase retains all 25 complete
results, collects garbage before and after, and reports the heap delta. The
isolated peak-RSS phase performs one operation in a fresh process and reports
the process high-water mark alongside before/after RSS. Import/startup time is
recorded separately. The 60-second outer campaign clock starts at CLI entry and
includes provider loading, fixture preparation, and semantic preflight children.
After preflight, scored workers share a 49-second inner budget clamped to the
remaining outer time. Incomplete identities stay failed or pending in the
ledger. These phases report raw observations and do not make an optimization
conclusion. Their mechanics are covered with injected fake operations; no real
provider timing campaign was run for this contract change.
<!-- yaml:2.9.0 ly:183287b0af74629615fbd6234575a0b1c7a176b5 -->
