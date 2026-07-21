---
title: "V8 JIT tier-residency and deopt audit of the hot parse + dump paths"
description: "An audit of whether lightning-yaml's hot parse and dump functions reach TurboFan and avoid steady-state deopts: a clean bill of health, nothing to fix"
---
**Verdict: Not worth pursuing** — the audit is a clean bill of health. Every hot parse
and stringify function reaches TurboFan (the top optimizing tier on this runtime), and
every deopt observed is a one-time warm-up deopt that converges; there is no
steady-state hot-path deopt and therefore no JIT-tiering CPU win to chase.

**Estimated benefit:** none (negative / reassuring result). No function is stranded in
the interpreter or Sparkplug, and no hot function churns between tiers on any tested
YAML shape (JSON-shaped block, rich anchors/tags/`!!binary`, or multiline block
scalars) or size (1 KB → 1 MB).

**Rigor:** fail-fast probe. One warm `--trace-opt --trace-deopt` run over the whole
fixture corpus (three parse+stringify rounds), analysed chronologically. This is the
tier-residency check the V8 optimization guide in the dossier (§7) specified but that was never actually run
against the parser until now.

---

## Background

The dossier's V8 optimization guide (§7) wrote out a recipe to verify that V8
actually optimizes lightning-yaml's hot functions and does not repeatedly *deoptimize*
them, but a grep confirms it was never executed — there is no `--allow-natives-syntax`
or `%GetOptimizationStatus` anywhere in the tree, and no tiering trace had been captured.
Every hot function that stays stuck in the interpreter, or that keeps bouncing out of
optimized code (a *deopt*), is a concrete, recoverable CPU cost, so this gap was worth
closing before chasing subtler levers.

Two pieces of V8 vocabulary matter for the rest of this report. **Tiering** is V8
promoting a function through compilers as it gets hot: Ignition (bytecode interpreter)
→ Sparkplug (a fast non-optimizing baseline) → TurboFan (the heavy optimizing compiler).
On some builds an intermediate **Maglev** tier sits before TurboFan. A **deopt**
(deoptimization) is V8 throwing away a function's optimized machine code and falling
back to the interpreter because an assumption baked into that code turned out to be
wrong — a value had an unexpected type, an object had an unexpected shape (V8 calls
these "maps"), or a call site saw a callee it had not compiled for. A single deopt
early in a process's life is normal and healthy; the same function deopting *over and
over* in steady state is the pathology, because each deopt discards optimized code and
forces a re-optimization.

The functions we care about are the ones that are genuinely hot on the parser's and
dumper's inner loops, per the architecture cheat-sheet in `src/index.ts`: on the parse
side `parseBlockNode`, `parseBlockMap`, `parseBlockSeq`, `resolvePlain`, `storeKey`,
`tryNumber`, `internKey`, `fastMatchBlockKey`; on the dump side `dumpScanRefs`,
`writeCollectionBody`, `writeEntryValue`, `writeScalar`, `writeStringScalar`, and
`encodeDoubleQuoted`. We only care about tiering for functions that are actually hot,
so cold rare-feature code is out of scope.

The relevant comparison point is that the reference we benchmark against — built-in
`JSON.parse` / `JSON.stringify` — is written in C++ inside V8. It does not tier and it
cannot deopt; it runs at full speed from the very first call. A pure-JS parser like
lightning-yaml, by contrast, must be *warmed up* by V8 before it runs at peak, and pays
whatever warm-up and deopt cost that entails. This audit measures exactly that cost.

## Experiment

A single scratch driver (`jit-run.ts`, reproduced at the end) imports `parse` and
`stringify` straight from `src/index.ts` via `tsx` and exercises them in a warm loop
designed to (a) drive per-node functions to tens of thousands of invocations so they
cross V8's optimization threshold, and (b) call the once-per-document entry points
(`parse`, `stringify`, `parseNextDocument`) enough times that they optimize too. The
loop runs three rounds; each round parses the small/medium/large `yaml-plain` fixtures,
the `yaml-rich` fixtures (anchors, tags, `!!binary`), and a constructed 400-record
document whose values are multiline literal (`|`) and folded (`>`) block scalars, then
stringifies the in-memory values built from the JSON fixtures plus the rich and
multiline values. The three shape families are deliberately **interleaved** so that
polymorphic value types flow through `storeKey`, `resolvePlain`, and `writeEntryValue`
within a single warm process — this is precisely the condition that surfaces a
shape/feedback deopt if one exists.

The process was run under `node --trace-opt --trace-deopt`, capturing every tier-up and
every deopt to a chronological log (426 events). Because the log is time-ordered, event
line numbers are a proxy for wall-clock order, which lets us distinguish *warm-up*
deopts (clustered early, followed by a re-optimization that then holds) from
*steady-state* churn (deopts that keep recurring after the function's final
optimization). The classification was made mechanically: for each function we checked
whether any **eager** deopt occurs *after* that function's last "completed optimizing"
event. A separate confirmation run added `--maglev`.

This is a fail-fast probe: it was run once on a shared machine while sibling research
agents were active, so absolute compile timings are indicative only. The signals this
audit relies on — which tier each function reaches, and the count and ordering of
deopts — are not wall-clock measurements and are robust to that load.

## Results

**Maglev does not participate on this runtime.** On Node 22.22.2 / V8 12.4, Maglev is
off by default (`--maglev` reports `default: --no-maglev`), and even when `--maglev` was
passed explicitly the trace still contained only `target TURBOFAN` tier-ups and zero
`target MAGLEV` tier-ups. The practical, shipping-relevant tier ladder here is therefore
Ignition → Sparkplug → **TurboFan**, and reaching TurboFan is the best available
outcome. Every number below is against that ladder.

**Every hot function reaches TurboFan.** Not one is stranded in the interpreter or
Sparkplug. The table lists each hot function, the top tier it reached, its deopt
inventory, and whether it converged (no eager deopt after its final optimization).

| Function | Tier reached | Deopts (kind × reason) | Converged? |
|---|---|---|---|
| `parse` | TurboFan | 0 | yes |
| `stringify` | TurboFan | 0 | yes |
| `parseNextDocument` | TurboFan | 0 | yes |
| `parseBlockNode` | TurboFan | 6 (2 eager *insufficient feedback: call*; 4 lazy) | yes |
| `parseBlockMap` | TurboFan | 6 (1 eager *insufficient feedback: named access*; 5 lazy) | yes |
| `parseBlockSeq` | TurboFan | 0 | yes |
| `resolvePlain` | TurboFan | 1 (eager *insufficient feedback: call*) | yes |
| `storeKey` | TurboFan | 0 | yes |
| `tryNumber` | TurboFan | 0 | yes |
| `tryNumberGeneric` | TurboFan | 1 (eager *insufficient feedback: named access*) | yes |
| `internKey` | TurboFan | 0 | yes |
| `fastMatchBlockKey` | TurboFan | 0 | yes |
| `publishRecordKeys` | TurboFan | 0 | yes |
| `parseBlockScalar` | TurboFan | 0 | yes |
| `dumpScanRefs` | TurboFan | 3 (1 eager *insufficient feedback: binary op*; 2 lazy) | yes |
| `writeCollectionBody` | TurboFan | 2 (1 eager *insufficient feedback: named access*; 1 lazy) | yes |
| `writeEntryValue` | TurboFan | 1 (eager *insufficient feedback: named access*) | yes |
| `writeScalar` | TurboFan | 1 (eager *insufficient feedback: call*) | yes |
| `writeStringScalar` | TurboFan | 1 (eager *insufficient feedback: call*) | yes |
| `encodeDoubleQuoted` | TurboFan | 0 | yes |
| `formatNumber` | TurboFan | 0 | yes |

**Every deopt converges.** The mechanical convergence check found **zero** functions
with an eager deopt occurring after their final optimization. For each function that
deopted, the last eager deopt precedes the last "completed optimizing" event, and the
function then produces no further deopt for the remainder of the run — which spans two
more complete parse+stringify rounds. A representative timeline, with `L###` being the
chronological event index out of 426:

- `resolvePlain`: optimized `L131` → one eager deopt `L132` → re-optimized `L179` →
  silent for the rest of the run.
- `parseBlockMap`: optimized `L152` → a burst of one eager + five lazy deopts at
  `L172–L177` → re-optimized `L184` → silent thereafter.
- `parseBlockNode`: optimized `L154` → deopts `L161–163` → re-opt `L205` → deopts
  `L284–285` → re-opt `L289` → silent thereafter.
- The dump-side functions (`dumpScanRefs`, `writeCollectionBody`, `writeEntryValue`,
  `writeScalar`, `tryNumberGeneric`) all deopt once around `L333–L367` and re-optimize
  by `L381`. These look "late" only because the dumper gets hot *after* the parser in
  each round; each is a first-time warm-up, not recurrence.

The final ~45 events of the trace (`L382–L426`) are pure optimization activity —
`encodeBase64`, `dumpNeedsAnchor`, `writeBinaryScalar`, `encodeSingleQuoted`,
`dumpAssignAnchor`, the rich/binary dump path — crossing the threshold in round three,
with **no deopts at all**. By the end of the run the whole hot surface is resident in
TurboFan and quiet.

**Two clusters of deopts need reading correctly, and both are benign.** First, every
*eager* deopt on our code carries the reason "Insufficient type feedback for {call,
generic named access, binary operation}". That reason means V8 promoted the function to
TurboFan before one particular call or property site inside it had accumulated its type
feedback — because the function got hot fast on the large fixtures while a
less-travelled branch had not yet run. The first time that branch executes in optimized
code, V8 eager-deopts, records the feedback, and re-optimizes. This reason is *by
definition* a warm-up condition; it is categorically different from the reasons that
signal a persistent problem — "wrong map", "not a Smi", "wrong instance type" — of which
our functions produced **none**. Second, the *lazy* deopts (all reason "unknown") are
not driven by our functions' own types at all: a lazy deopt fires when optimized code is
invalidated because something it depended on changed. The five lazy deopts on
`parseBlockMap` land on consecutive trace lines at the same bytecode offset — the
signature of a single invalidation event unwinding a *recursive* call stack, where each
active `parseBlockMap` frame gets its own lazy-deopt record. It is one logical event,
not five problems.

**The only non-warm-up deopt is not ours.** A function named `get` took a single "wrong
name" deopt and then optimized to TurboFan. This is a `Map#get` / loader helper (we
define no function named `get`; our `.get(` call sites are all `Map.prototype.get` on
`anchorMap` / `tagHandles` / `keyCache` / `dumpRefCounts` / `dumpAnchors`), it deopted
once, and it converged. Three further deopts in the raw log belong to `node:path`'s
`normalizeString`, `tsx`/esbuild's `parseSource`, and the driver's own `burn` — all
harness/loader, none in the parser.

**Coverage caveat.** `scanFlowPlainLine` and `tryFlowNumber` never
optimized in this run. That is because the corpus is block-style YAML and does not
exercise the *flow* scalar path (`[...]` / `{...}` inline collections); these functions
were cold-because-unused, not stuck in a low tier. The block-style number path
`tryNumber` — the one that matters for JSON-shaped block YAML — reached TurboFan
cleanly with zero deopts. A flow-heavy corpus would be needed to audit the flow scalar
path, and that is the one acknowledged gap in this probe.

## Interpretation and recommendation

The parser and dumper are in excellent shape at the JIT level. The entire hot surface —
the block map/seq/node walkers, plain-scalar resolution, key storage and interning, the
number path, and the whole collection-writing and scalar-quoting side of the dumper —
tiers up to TurboFan and stays there. The deopts that occur are the expected warm-up
transient of any pure-JS hot loop under V8: each hot function takes at most a couple of
"insufficient type feedback" eager deopts as its rarer branches are seen for the first
time, re-optimizes with fuller feedback, and then holds TurboFan residency through the
rest of the workload. There is no megamorphic property write, no shape (map) instability,
and no polymorphic-value deopt surviving into steady state — which is a real, non-obvious
compliment to the existing design decisions the cheat-sheet documents (keys assigned in
encounter order for a stable hidden class, packed arrays, the `FastKeyMatch` sibling-key
reuse, the `__proto__` guard via `defineProperty`). Interleaving three different value
shapes through the same functions did not destabilise them.

Because there is no steady-state hot-path deopt, there is nothing to fix, and no CPU win
to be had from JIT-tiering work. The brief asked for a proposed fix per hot-path deopt;
the honest answer is that there are no hot-path deopts to fix, so the recommendation is
to make no source change on these grounds.

The one place where the pure-JS parser is genuinely at a disadvantage to the `JSON`
built-in is warm-up itself, and it is worth stating plainly because it is the correct
framing against our benchmark baseline. `JSON.parse` and `JSON.stringify` are C++ and
run at peak from call one. lightning-yaml must be warmed: its first parses and
stringifies run in Ignition, then Sparkplug, triggering a handful of background TurboFan
compilations and the warm-up deopts catalogued above before the code converges. For a
long-lived process (a server, a watch task) this is a one-time cost of a few
milliseconds, amortised to nothing — the steady state, which is what our throughput
benchmarks measure, is exactly the clean TurboFan residency this audit confirms. For a
*parse-once-and-exit* process (a CLI invocation, a cold serverless function) the story
is different but not improvable from library source: the functions may never get hot
enough to reach TurboFan at all, so they run in Sparkplug and the deopts never happen —
you simply do not get the optimized-tier speed in that regime, and that is inherent to
tiered JITs, not a defect to patch. The only lever here is runtime-side, not
source-side: an intermediate Maglev tier (Node ≥24, where Maglev is default-on, or a
future V8) shortens the climb to peak, but on this Node 22.22.2 build Maglev does not
engage and TurboFan is the whole optimizing story.

Confidence in the negative result is **high** for the block-style paths (JSON-shaped,
rich, and multiline), which the corpus exercises thoroughly, and **medium** for the flow
scalar path, which this block-only corpus does not touch and which a follow-up should
cover before the audit is called complete.

A reusable by-product of this audit is the tier-residency harness itself — the scratch
driver plus the two analysis passes (per-function marked/optimized/deopt counts, and the
"eager deopt after last optimization?" convergence check). This is the never-built check
the dossier wanted, and it could in principle become a CI guard that fails if a hot
function stops reaching TurboFan or starts churning; that is future work, noted, not
recommended for this round.

### Reusable recipe (others can run this)

```bash
# 1. Warm run under the tiering tracer (jit-run.ts imports parse/stringify from src,
#    loops parse+stringify over every fixture family three times, interleaved).
node --trace-opt --trace-deopt --import tsx jit-run.ts > trace.txt 2>&1

# 2. Per-function tier + deopt inventory (repeat for each hot function name):
for fn in parseBlockMap resolvePlain writeCollectionBody dumpScanRefs tryNumber; do
  echo "$fn: opt=$(grep -c "completed optimizing.*<JSFunction $fn (" trace.txt)" \
       "deopt=$(grep -c "deoptimizing.*<JSFunction $fn (" trace.txt)" \
       "$(grep "completed optimizing.*<JSFunction $fn (" trace.txt | grep -oE 'target [A-Z]+' | tail -1)"
done

# 3. Convergence gate — is there any EAGER deopt AFTER the function's last optimization?
#    (lazy deopts after re-opt on a recursive fn are the benign stack-unwind artifact.)
#    last_eager_deopt_line > last_completed_opt_line  ==>  steady-state churn (bad).
```

Note two portability gotchas found while building it: `--trace-maglev` is a V8-internal
flag that Node's CLI rejects ("bad option"), so use `--trace-opt`, which already tags
each tier-up with its target tier; and under `tsx` the function names survive esbuild
transpilation, so grepping the trace by source function name works directly.

## Code references

- `parseBlockNode` — `src/index.ts:2864`
- `parseBlockMap` — `src/index.ts:3435`
- `parseBlockSeq` — `src/index.ts:3387`
- `resolvePlain` — `src/index.ts:2016`
- `storeKey` — `src/index.ts:1567`
- `tryNumber` — `src/index.ts:2254`
- `internKey` — `src/index.ts:1782`
- `fastMatchBlockKey` — `src/index.ts:1827`
- `dumpScanRefs` — `src/index.ts:4399`
- `writeCollectionBody` — `src/index.ts:4732`
- `writeEntryValue` — `src/index.ts:4766`
- `writeScalar` — `src/index.ts:4661`
- `writeStringScalar` — `src/index.ts:4626`
- `encodeDoubleQuoted` — `src/index.ts:4566`
- `.get(` call sites (`Map.prototype.get` on `anchorMap`/`tagHandles`/`keyCache`/`dumpRefCounts`/`dumpAnchors`) — `src/index.ts:753, 917–937, 1783, 4402, 4777`
- `scanFlowPlainLine` — `src/index.ts:1866`
- `tryFlowNumber` — `src/index.ts:2140`
- `parse` — `src/index.ts:515`
- `stringify` — `src/index.ts:581`
- `parseNextDocument` — `src/index.ts:4209`
- `tryNumberGeneric` — `src/index.ts:1096`
- `publishRecordKeys` — `src/index.ts:1849`
- `parseBlockScalar` — `src/index.ts:3900`
- `formatNumber` — `src/index.ts:4646`

## Provenance & sources

- Repo: lightning-yaml @ 0f6943e (branch claude/yaml-parser-perf-research-l73742), 2026-07-14.
  Source audited unchanged; no file under `src/` was modified.
- Runtime: Node 22.22.2 / V8 12.4 (Ignition → Sparkplug → TurboFan; Maglev `--no-maglev`
  by default and did not engage even when `--maglev` was passed). Build target ES2022,
  loaded via `tsx` (esbuild transpile, function names preserved).
- Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, 4 vCPU, Linux 6.18.5.
- Fixtures: `bench/fixtures/data/` (gitignored, reproducible via `pnpm gen:fixtures`) —
  `yaml-plain-*`, `yaml-rich-*` (anchors/tags/`!!binary`), plus an in-driver constructed
  400-record multiline (`|`/`>`) document. No external YAML library was relied on.
- Method: one warm `node --trace-opt --trace-deopt --import tsx` run (426 trace events,
  three interleaved parse+stringify rounds), plus a `--maglev` confirmation run;
  chronological deopt-vs-reoptimization analysis.
- The tier reached, the deopt counts and reasons, and the deopt/optimization ordering
  are the durable signals and are load-independent; the run shared the machine with
  concurrent agents, so absolute compile-time figures in the raw trace are indicative
  only and were not used.
- Rigor of this study: **fail-fast probe.**
