# Rebuilding the generated Dafny module

The shared implementation lives in `src/dafny/core/`: `Native.dfy`,
`TagValues.dfy`, `Engine.dfy`, `Serializer.dfy`, `SurfaceValues.dfy`,
`SurfaceOptions.dfy`, `SurfaceHelpers.dfy`, `SurfaceErrors.dfy`, and
`SurfaceHost.dfy`. The option-decision methods live in
`src/dafny/core/SurfaceOptions.dfy`. This is a source-organization boundary; it
does not claim complete public-surface contracts. TypeScript host bindings,
diagnostics, the bridge, and generated output remain under `src/dafny/`.

The checked-in `src/dafny/generated/engine.js` is produced from those sources with
the official Dafny 4.11.0 compiler using
`translate js --unicode-char false --no-verify --include-runtime`. UTF-16 character
representation is explicit; generated-code translation still skips verification
for the full evolving source tree. A separate CI verification step verifies a
selected scanner tranche against the original source with Dafny 4.11.0's legacy
`/compileTarget:js /compile:0` verifier options, so the JS-only
`{:nativeType "number"}` declarations remain present. CI pins Z3 4.16.0 by the
SHA-256 of its official release archive because Dafny's NuGet package does not
include Z3. `translate` emits JavaScript without running its generic runtime,
which keeps the compiler's BigNumber helper out of the build and avoids adding a
runtime dependency. Run `pnpm dafny:generate` with `dafny` 4.11.0 available on
`PATH`, or set `DAFNY` to the compiler executable. `pnpm dafny:check` also compares
the regenerated artifact byte-for-byte and runs the output-boundary mutation
tests.

CI installs the exact [`Dafny` 4.11.0 NuGet tool](https://www.nuget.org/packages/Dafny/4.11.0) from the official NuGet v3 feed with .NET SDK 8.0.408. This pins the published package version and source feed; the tool bootstrap itself is not covered by the JavaScript lockfile. The generator verifies the compiler-reported version, and the generated header records a SHA-256 digest of every Dafny source file in compilation order.

The generator AST-extracts seven retained program modules from the compiler output, after checking the compiler output's expected top-level structure. It omits the unused runtime modules, Dafny's unused Native type module, the compiled `SurfaceValues` ghost model, and the host-intrinsic declaration module `SurfaceHost`; the extraction fails if an omitted model remains referenced by retained code. A second AST pass lowers a fixed, exact-count list of compiler-emitted generic equality and Euclidean arithmetic helper sites to host primitives; the list is tied to generated class/method names and the output guard checks the resulting native calls. Current string equality sites were inspected in the Dafny source: their operands are YAML tag/word strings. This lowering does not authorize opaque YAML value equality.

The final shape pass is separately guarded by `scripts/dafny-shape-manifest.json`, which pins native helper bodies and use sites, literal static-getter inventory, reflection metadata shape, Engine/Writer method and field maps, field access counts, and adjacent compiler-temporary patterns. It removes only the empty generated `_parentTraits` methods and their `_tname` assignments listed in the reviewed manifest, after confirming there are no remaining metadata references. It inlines Native identity casts and exact primitive helpers for arithmetic, strings, array/object reads, type checks, and Map/Set reads. Calls must match the frozen host implementation and their arguments must be simple identifiers or literals. Void array/map/set mutations inline only when the original call is an expression statement. The direct expressions retain source operator grouping and each argument's evaluation count. Static getters with one primitive literal return are inlined. Internal Engine/Writer method names are shortened while constructor, bridge and document-diagnostic entry points stay stable.

The shape pass also folds the adjacent Dafny `_outN = expression; local = _outN;` pairs listed in the reviewed manifest. It requires one uninitialized local declaration, exact adjacency, no nested function/closure, and no other reads or writes to that temporary. Only identifier or Engine/Writer self-field assignment targets are accepted. Private Engine/Writer state fields receive pinned short names but remain ordinary fields on each instance. Diagnostic-facing Engine fields `pos`, `len`, `src`, `lineStart`, and `tagHelpers` keep their names. The output guard checks the final method inventory and renamed field access counts against the pinned manifests; direct generated Map/Set/array calls are also explicitly listed in its allowlist. A changed helper body/callsite, getter, metadata reference, member inventory, rename target, temporary pattern, runtime reference, or output binding fails closed.

The shape pass lowers the 319 pinned indexed string code-unit reads from `s[i].charCodeAt(0)` to `s.charCodeAt(i)`. For an in-range integral string index, both read the same UTF-16 code unit. The source sites use Dafny string indexing with `Index` bounds and caller guards; they are classified by generated method and receiver in the shape manifest. This does not preserve arbitrary JavaScript behavior for an out-of-range or fractional index (`s[i].charCodeAt(0)` throws where `s.charCodeAt(i)` returns `NaN`). The translator runs with `--no-verify`, so this relies on the Dafny source indexing domain and is not a proof. The 165-case generated-runtime differential, including malformed boundary inputs, passed, but does not establish equivalence for every possible input or internal state. The output-size experiments used unminified compiler output and gzip level 9, so their byte counts are not final bundled-size or runtime evidence.

The declarations in `generated/engine.d.ts` are a checked boundary: generated values enter TypeScript as `unknown`. Their ABI digest is pinned in `dafny-output-guard.json`. `native.ts` exports the named trusted host intrinsics; generated output imports only the names in its pinned use-site inventory. `native-diagnostics.ts` assembles those same exports into a test-only namespace for injected-host regression checks. Parser recognition, scanning, folding, control flow and serializer traversal belong in Dafny source. The guards and generated-runtime tests detect specified generated/runtime shape regressions; they do not prove semantic equivalence, allocation behavior, absence of every compiler transformation, or performance.

## Scoped scanner verification

`pnpm dafny:verify:scanner` verifies the executed `FlowSeparatorAt`, `ScanFlowPlainLine`, `TrimTrailingWs`, `SkipInlineSpaces`, `IsSpaceOrEolAt`, and `IsDocMarkerAt` methods plus their ghost specification dependencies under Dafny 4.11.0 with UTF-16 characters. It writes CSV proof logs and a machine-readable coverage report to `results/dafny-scanner-proof/`. The methods establish their stated lexical boundary, first-stop, maximal trailing-whitespace suffix, consumed-inline-whitespace-prefix, and document-marker contracts. All six methods have empty heap frames except `SkipInlineSpaces`, which permits changes only to the cursor field. Four selected predicates have no generated verification conditions and are recorded as `no-verification-conditions`, not as semantic proofs.

`pnpm dafny:verify:options` verifies five executed methods in the retained
`SurfaceOptions` module: the yaml parse/stringify and js-yaml loadAll slot
selectors, the yaml stringify primitive check, and recognized option-rule
decisions. The pinned selected run reports six proof obligations. Ten valid
body mutations are rejected by the selected correctness proofs. The ghost
`SurfaceValues` model and `OwnRuleCode` are source-pinned; the broad selected
run emits no verification condition for the `OwnRuleCode` ghost function, so
that absence is recorded explicitly. The public option rules call these
generated decisions, while the AST-based contract checker compares all four
TypeScript option tables against `OwnRuleCode` codes 1–7.
Generated-runtime tests replace each retained decision method with a frozen
sentinel and call the exported yaml and js-yaml entry points, checking that the
same sentinel reaches the caller. A temporary bypass of the yaml parse selector
was rejected by this test; this route check does not prove parser behavior.

These option proofs are conditional on the supplied host-observation booleans
matching the ghost descriptors. The correspondence for JavaScript truthiness,
`typeof`, array classification, strict identity and string equality is not
proved by Dafny. `SurfaceValues` distinguishes `document.all`-like HTMLDDA for
the loose-nullish options check, but this does not prove a browser host
classifier. Option property enumeration/getters, proxy throws, prototype rule
lookup, thrown-value identity, complete validation order, parser/writer
meaning, and public-operation completion remain outside the selected proofs.
The manifest therefore reports no fully verified public operations.

`SurfaceHelpers` and `SurfaceErrors` add eight directly routed helper methods.
A selected local verification run reported 9 verification obligations passed
with no errors. These are helpers rather than complete public operations:
`TagKindName` chooses a node-kind string, `ReturnSchemaIdentity` and
`ReturnCapturedContents` forward their argument, the three name methods choose
constant strings, and the two exception methods choose between the supplied
value and fallback using a supplied strict-nullish flag. The last two results
match `??` only when that flag is the correct JavaScript observation. The
generated route tests demonstrate that the public factories, closures, and
constructors call the methods; they do not prove Error allocation/prototypes,
fresh marks, object descriptors, or the surrounding TypeScript behavior. See
`Helpers-Errors.audit.md` for the exact scope.

`NativeSurface.Adapter` contains the executable normalization, parse/reset/
cleanup, stringify, exception-string, and not-implemented-message control
bodies. Their host operations capture raw return/throw completions. Generated
route tests exercise those methods through public entry points and check
getter/coercion order, cleanup error identity, and eager adapter construction.
These bodies still lack attached complete ordered-trace postconditions and
selected proofs; host getter/coercion correspondence and the generated parser/
writer semantics remain open. The methods must not be counted as complete
public-operation contracts from their route tests or from
`SelectCompletionAfterCleanup` alone.

The six conditional scanner method proofs require `len as int == |src|` and their stated cursor or span bounds. `IsDocMarkerAt` also requires conditional arithmetic slack when its input index equals `lineStart`; no selected caller proof establishes that `lineStart` is the actual beginning of a source line. No caller has been proved to establish these preconditions. Native host bindings, the remaining parser and serializer methods, other scanner methods, and the backend/output postpass remain trusted or unproved. These selected tranches prove neither complete parsing nor full YAML semantic equivalence. Dafny generation still uses `--no-verify` for the full source tree, and CPU and memory performance acceptance remains separate.

Generated JavaScript carries the Dafny Project copyright and MIT SPDX notice. The accompanying `Dafny-LICENSE.txt` is included in the npm package.

## Current validation status

The current source and generated artifact pass the Dafny reproducibility/output guards and generated-runtime checks, parser and adversarial tests, stringify tests, compatibility diagnostics, YAML suite, type and consumer checks, Vitest, and package build. The YAML suite reports 364/373 passing cases with the same nine baseline failures (`2XXW`, `565N`, `9MQT/01`, `DK95/01`, `DK95/06`, `HWV9`, `J7PZ`, `M7A3`, `QT73`). Compatibility totals match baseline (481/526 for js-yaml compatibility and 518/528 for yaml compatibility). These comparisons are not a proof of equivalence.

CPU and memory acceptance are pending. One exploratory paired run on the preceding 653 checkpoint put all 26 speed rows within 1.15x, but that is a single pair and not acceptance evidence; this integrated snapshot has not been measured. Bundle-size results are informational and are not an acceptance blocker under the current scope: an earlier five-bundler comparison was 1.51–1.55x, while an isolated candidate-only comparison of the third pass reduced gzip-9 size from 19,691 to 18,177 bytes. These bundle results do not compare the current artifact to the handwritten baseline. No performance acceptance is claimed.
