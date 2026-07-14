# Columnar (struct-of-arrays) storage behind a proxy facade

**Verdict: Not worth pursuing** — the compact columnar store is real, but the
per-row facade needed to keep the plain-object API costs *more* memory than the
plain objects it replaces, and slows reads.

**Estimated benefit:** none as a drop-in. The columnar store alone is ~6× smaller
than the plain object array (0.17× its heap), but the facade that preserves
`arr[i].field` access pushes total heap to **2.43× the plain array** and reads to
**2.8× slower**. This is a **memory-and-CPU loss** for the plain-object contract on
every shape. The transferable part of the win (deduping repeated string values) is
already captured, parity-safe, by value interning (the value-interning study).

**Rigor:** fail-fast probe (one synthetic record corpus, one Proxy design, heap and
read throughput measured in-process).

## Background

The memory gap is that lightning-yaml retains 2.3–2.7× `JSON`'s heap on
medium record arrays. The owner's "wild idea" is to stop paying a full JS object
plus repeated field slots per record: store a homogeneous record array
**columnar** (one array per field — struct-of-arrays), and expose objects that
*act* normal via magic getters, so `array[i].firstName` still works but the backing
store is compact.

The plain-`{}` output is an API-parity mandate (`docs/research/12` §6), and a prior
pass (`docs/research/09` §5) rejected getter/Proxy facades on three blockers:
broken `Object.keys`/spread/`deepEqual` semantics, damaged consumer hidden-class
monomorphism, and source-string pinning. This probe confronts those blockers with
actual numbers, and separately measures whether the columnar store is even worth the
trouble.

## Experiment

Starting from a parsed 5,000-record array (the same corpus as the value-interning study: flat
scalar fields plus a nested `tags[]` and `meta{}` per row), I built three
representations and measured the heap each retains, using `process.memoryUsage()`
around GC settles:

1. **plain** — the ordinary array of `{}` records the parser returns today.
2. **columnar store only** — one packed array per top-level field, with strings
   interned within each column. Accessed as `cols[field][i]`; no per-row object.
3. **columnar + proxy facade** — the store, plus one `Proxy` per row whose `get`,
   `has`, `ownKeys`, and `getOwnPropertyDescriptor` traps read from the columns, so
   each row still behaves like a plain object.

Read throughput was a tight loop summing a numeric field across all rows (warm,
post-JIT, 200 repeats, minimum taken). Parity was checked on a facade row against
its plain twin: `JSON.stringify` equality, `assert.deepStrictEqual`, `Object.keys`,
object spread `{...row}`, and `for..in`.

Measured under concurrent agent load; **ratios are the robust signal**, absolute
ms/MB are indicative.

## Results

Retained heap for the 5,000-record array:

| Representation | Retained heap | Ratio vs plain `{}[]` |
| --- | --- | --- |
| plain array of objects | 3.03 MB | 1.00× |
| columnar store only (no facade) | 0.50 MB | **0.17×** |
| columnar store + per-row proxy facade | 7.38 MB | **2.43×** |

Read throughput (sum one numeric field over all rows):

| Access path | ms / full sweep | Ratio vs plain |
| --- | --- | --- |
| plain object `row.score` | 0.072 | 1.00× |
| proxy facade `row.score` | 0.199 | **2.8×** |

Parity of the proxy facade vs a plain row — all **passed**:

| Operation | Result |
| --- | --- |
| `JSON.stringify(row)` | identical |
| `deepStrictEqual(row, plain)` | OK |
| `Object.keys(row)` | identical |
| spread `{...row}` | identical |
| `for..in` keys | identical |

## Analysis

Two findings, pulling in opposite directions.

First, the columnar store really is compact — **0.17× the plain array**, a ~6×
reduction. Packed per-field arrays plus in-column string interning strip out the
per-object headers and the duplicate value strings in one move. (This figure
slightly understates a standalone store, because the nested `tags[]`/`meta{}`
columns hold references to objects still shared with the source array rather than
fresh copies; but even doubled it is far under the plain 3 MB.) If a consumer were
willing to read data *columnar-first* — `store.field[i]` — this would be a large,
genuine memory win.

Second, that is not the API lightning-yaml promises, and bridging to the plain
`arr[i].field` API destroys the win. Materialising one `Proxy` per row to preserve
that access pattern adds ~6.9 MB for 5,000 rows — roughly 1.4 KB per row for the
proxy object, its target, and its trap closures — so the "compact" representation
ends up at **2.43× the plain array it was meant to shrink**. Reads through the trap
are **2.8× slower**, because every property access detours through a JS `get`
handler instead of an inline-cached slot load. The facade re-introduces exactly the
per-row object cost the columnar store removed, and then adds proxy overhead on top.

The one surprise is parity: with `ownKeys` plus a `getOwnPropertyDescriptor` that
reports each field `enumerable` and `configurable`, the facade passes
`JSON.stringify`, `deepStrictEqual`, `Object.keys`, spread, and `for..in`. The
first blocker from `docs/research/09` (broken enumeration/equality) is therefore
*surmountable* with careful traps — but it does not matter, because the memory and
speed blockers are fatal on their own. (The hidden-class/monomorphism and
source-pinning blockers were not separately stressed here; they would only add to
the cost.)

## Conclusion & recommendation

**Not worth pursuing** as a way to serve the plain-object API. The columnar store's
compactness is unreachable without either (a) exposing a columnar access API, which
violates the plain-`{}` mandate, or (b) a per-row facade, which is heavier and
slower than the plain objects it replaces. There is no configuration in which the
facade both keeps the API and saves memory.

Crucially, the *transferable* portion of the columnar idea — the fact that repeated
string values are deduplicated — does **not** require the store or the facade at
all. Interning string values while emitting ordinary `{}` records
(**the value-interning study**) captures that benefit (−28% retained heap on this corpus),
parity-safe, at a modest CPU cost. That is where the recoverable memory lives; the
struct-of-arrays scaffolding around it is what fails to pay off.

Recommendation: close the facade direction and route the effort into value interning
(the value-interning study). Confidence: **high** that the facade is a net loss for the plain-object
contract; the numbers are lopsided (2.43× heap, 2.8× reads) and not sensitive to
tuning. Audience: this conclusion holds for any shape that must present as plain JS
objects, which is all of lightning-yaml's output.

## Provenance & sources
- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
- Runtime: Node 22.22.2 / V8 12.4. Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, Linux 6.18.5.
- Deps used: `yaml` 2.9.0 (only to serialize the synthetic corpus). `JSON`/plain `{}[]` is the only comparison baseline.
- Prototype & harness: a scratch representation microbench building plain / columnar / columnar+proxy from a parsed 5,000-record corpus, with in-process heap-Δ, a warm read-throughput loop, and five parity assertions. `src/` was not modified.
- Measured under concurrent agent load: ratios are durable; absolute ms/MB are machine-specific and indicative.
- Rigor of this study: fail-fast probe.
