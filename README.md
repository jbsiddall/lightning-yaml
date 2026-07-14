# ⚡ lightning-yaml

**YAML parsing at JSON.parse speed.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml/badge.svg)](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lightning-yaml.svg)](https://www.npmjs.com/package/lightning-yaml)

lightning-yaml is a pure-JS YAML 1.2 parser and stringifier that parses and
writes at speeds approaching native `JSON.parse`/`JSON.stringify` — while passing
~97.6% of the official [yaml-test-suite](https://github.com/yaml/yaml-test-suite),
ahead of js-yaml and the `yaml` library. It's an API-level drop-in for either —
same exports and call signatures, ESM + CJS + full TypeScript types, small bundle
(option arguments aren't honoured yet; see [Drop-in](#drop-in-for-js-yaml-or-yaml)).
No more trading YAML's readability for JSON's performance.

- **Fast.** Parses and stringifies at speeds approaching native
  `JSON.parse`/`JSON.stringify` — far ahead of existing JS YAML libraries.
- **Spec-compliant.** Passes ~97.6% of the official yaml-test-suite — more than
  js-yaml or `yaml`.
- **Drop-in (API-level).** Same exports and signatures as `yaml` and `js-yaml` —
  swap the import and your code runs. Option arguments (`schema`, `sortKeys`,
  `indent`, …) are still accepted-but-ignored today; see
  [Drop-in](#drop-in-for-js-yaml-or-yaml).
- **Lean.** Small bundle; ships ESM + CJS + full TypeScript types.
- **Complete.** Full YAML 1.2 core — flow & block syntax, anchors/aliases, tags
  incl. `!!binary`, multi-document streams, and more.

## Benchmarks at a glance

Measured primarily against native `JSON.parse` — the bar this project holds
itself to — with js-yaml and `yaml` for context. Representative figures on the
maintainer's machine; the full tables (all datasets, every parser) live in
[BENCHMARKS.md](BENCHMARKS.md).

| Representative metric      | `JSON.parse` | **lightning-yaml** |  js-yaml |    yaml |
| -------------------------- | -----------: | -----------------: | -------: | ------: |
| Parse — large records      |       8.6 ms |        **19.2 ms** |   104 ms |  964 ms |
| Peak RSS — 10 MB document  |       284 MB |         **369 MB** |   975 MB | 2.68 GB |
| Bundle — minified / gzip   |     _native_ |  **40 KB / 12 KB** | 52/16 KB | 96/29 KB |

That's roughly **2× `JSON.parse`'s parse time** and **~1.3× its peak memory** on
large inputs — versus ~12× / ~3.4× for js-yaml and ~110× / ~9.6× for `yaml`.

Full benchmarks (all datasets, every parser) →
[lightning-yaml.dev](https://lightning-yaml.dev) · [BENCHMARKS.md](BENCHMARKS.md)

## Install

```bash
npm install lightning-yaml
pnpm add lightning-yaml
yarn add lightning-yaml
bun add lightning-yaml
```

## Quick start

```ts
import { parse, parseAll, stringify } from 'lightning-yaml';

parse(`
name: lightning-yaml
version: 0.1.0
features: [fast, spec-compliant, drop-in]
`);
// → { name: 'lightning-yaml', version: '0.1.0', features: ['fast', 'spec-compliant', 'drop-in'] }

stringify({ hello: 'world', list: [1, 2, 3] });
// → "hello: world\nlist:\n  - 1\n  - 2\n  - 3\n"

parseAll('---\na: 1\n---\nb: 2\n');
// → [{ a: 1 }, { b: 2 }]   (multi-document streams)
```

### Drop-in for `js-yaml` or `yaml`

Already using another YAML library? Swap the import, keep your code.

```ts
// Coming from js-yaml? Change one import:
import { load, dump } from 'lightning-yaml/js-yaml';

// Using the `yaml` library? Same deal:
import { parse } from 'lightning-yaml/yaml';
```

> **Status — API-level today.** The shims match the *surface* (same
> exports and call signatures), so your code compiles and runs. They do **not**
> yet honour most **option arguments**: `load(text, { schema })`,
> `dump(obj, { sortKeys, indent })`, `parse(text, { version })` and friends are
> accepted but currently **ignored**, so behaviour can differ from the original
> library. This layer is genuinely useful for migrating — but it isn't where we
> want it yet. The full per-option support matrix (and what's easy to add next)
> is the module doc for [`src/js-yaml-compat.ts`](src/js-yaml-compat.ts) and
> [`src/yaml-compat.ts`](src/yaml-compat.ts), also published under the
> [API reference](https://lightning-yaml.dev). Goal: maximise compatibility
> without ever compromising YAML-1.2 correctness or core speed.

### Browser / CDN

```html
<script src="https://cdn.jsdelivr.net/npm/lightning-yaml/dist/lightning-yaml.min.js"></script>
<script>
  const data = YAML.parse('greeting: hello');
</script>
```

Or as modern ESM, no build step:

```js
import { parse } from 'https://cdn.jsdelivr.net/npm/lightning-yaml/+esm';
```

ESM, CommonJS, and TypeScript types all ship in the box.

## Project priorities

In order:

1. **Compliance with the YAML 1.2 specification.** Correctness comes first,
   always — a fast parser that mis-reads your config is worthless.
2. **Parity with the browser's native `JSON.parse` / `JSON.stringify`** on speed
   and memory — so there's no performance reason left to avoid YAML.

## Contributing & feedback

This is a young library, and the best way to help right now is to **use it and
report what breaks**:

- **Found a mis-parse or a crash?**
  [Open an issue](https://github.com/jbsiddall/lightning-yaml/issues) with the
  input YAML. Real-world edge cases directly drive the roadmap.
- I'm **not taking code PRs directly** at the moment — but **bug reports and
  edge-case YAML are hugely welcome** and are the most valuable thing you can
  contribute.
- Questions, ideas, or just want to chat? Head to
  [GitHub Discussions](https://github.com/jbsiddall/lightning-yaml/discussions).
- Guides and the full, most-current benchmarks live at
  [lightning-yaml.dev](https://lightning-yaml.dev).

## Status & scope

YAML 1.2 core, feature-complete apart from merge keys (`<<`). lightning-yaml
passes **~97.6% of the official yaml-test-suite** (364/373) — ahead of both
js-yaml and the `yaml` library. Merge keys are the one known gap.

## Built with Claude Code

lightning-yaml is built with the help of
[Claude Code](https://www.anthropic.com/claude-code), but **every commit is
human-reviewed and I'm accountable for all of the code**. The aim is the leverage
of AI without a vibe-coded, unreviewed repo — the assistant helps write it, a
human owns it.

## License

[Apache License 2.0](LICENSE) — © 2026 Joseph Siddall.

---

The rest of this README documents how lightning-yaml is built, measured, and
tested — useful if you want to reproduce the benchmarks or understand the design.

## Approach

- **Test data spans three categories** (all generated deterministically from a
  seeded PRNG, across a matrix of sizes and shapes):
  - **JSON** — JSON is a subset of YAML 1.2, so the exact same bytes feed
    `JSON.parse` and both YAML parsers (~1 KB → ~10 MB). A clean apples-to-apples
    comparison.
  - **YAML, plain** — the same JSON-shaped data emitted as *block* YAML, with no
    tags or anchors: "just JSON structures, in YAML syntax". `JSON.parse` can't
    read block YAML, so it's dropped from parsing these (but stays as a stringify
    baseline — the value is still JSON-compatible).
  - **YAML, rich** — block YAML that uses YAML-only syntax: the `!!binary` tag
    (base64 blobs) and `&anchor`/`*alias` graph references (shared object
    references). JSON can neither read the text nor represent the value, so it's
    dropped from these entirely.

  Which candidates run for which (category, op) is decided by `candidateApplies`
  in [`bench/candidates.ts`](bench/candidates.ts).
- **Speed → [mitata](https://github.com/evanwashere/mitata), run sequentially.**
  mitata JIT-compiles a batched measurement loop (4096 iters between timestamps)
  and has a `do_not_optimize` guard, so it stays accurate down to sub-microsecond
  ops like `JSON.parse` — where Vitest/tinybench (one timestamp per call, no
  anti-DCE guard) loses resolution. Benchmarks run **one at a time**: parallel
  micro-timing is corrupted by CPU frequency scaling, cache/port contention, and
  shared stop-the-world GC.
- **Peak memory → isolated child processes, run sequentially.** See below.

## Why a separate memory harness

mitata reports a memory column, but it is **not** what we need. mitata measures
the **per-iteration V8 heap-allocation delta** (`v8.getHeapStatistics()`) — it
never touches OS resident memory (a grep of the package for `resourceUsage`/
`maxRSS`/`rss` finds nothing). That number **excludes native/off-heap memory**
(string backing stores, `ArrayBuffer`s, native-addon allocations), which for a
parser can dominate.

Our harness instead spawns one isolated process per candidate and reads
**`process.resourceUsage().maxRSS`** — the whole-process peak resident set (heap
+ native + external). The gap is not academic. Parsing the 10 MB fixture:

| candidate | **peak RSS** (our harness) | heap Δ (what mitata sees) |
| --------- | -------------------------- | ------------------------- |
| JSON      | 282 MB                     | 17.4 MB                   |
| js-yaml   | 495 MB                     | 38 MB                     |
| **yaml**  | **2.63 GB**                | **39.8 MB**               |

mitata would report `yaml` at ~40 MB and **miss the 2.63 GB reality** — a 66×
blind spot of exactly the native/off-heap memory a YAML parser burns. So the two
tools are complementary: mitata for speed + per-call heap churn, our harness for
true peak RSS.

Each candidate runs in its **own OS process** (the correct isolation for a clean
peak), and workers run **one at a time**. We deliberately do *not* run them
concurrently: co-running the heavy parses (that 2.63 GB `yaml` job) can push the
machine into swapping, which corrupts RSS in ways that are hard to account for.
Sequential keeps every number trustworthy.

Iterations are fixed (`BENCH_ITERS`, default 25) and **should stay fixed**: peak
RSS is a sustained-allocation high-water mark that grows with iteration count
(e.g. `yaml` on the 1 MB fixture reports ~520 MB at 25 iterations but only
~308 MB at 5), so changing it shifts the peak-RSS numbers. `heap Δ` is
iteration-independent.

## Candidates

Grouped in [`bench/candidates.ts`](bench/candidates.ts) — a single registry
reused by every benchmark:

| name           | group       | kind | parse                    | stringify             |
| -------------- | ----------- | ---- | ------------------------ | ---------------------- |
| JSON           | baseline    | json | `JSON.parse`             | `JSON.stringify`       |
| js-yaml        | competition | yaml | `load`                   | `dump`                 |
| yaml           | competition | yaml | `parse`                  | `stringify`            |
| lightning-yaml | ours        | yaml | `src/index.ts` _(M0–M5)_ | `src/index.ts` _(M6)_  |

`lightning-yaml` (group `ours`) is wired to [`src/index.ts`](src/index.ts). Its
`parse` covers the full YAML 1.2 core feature set — flow/block syntax, block
scalars, anchors/aliases, tags including `!!binary`, directives, and
multi-document streams. `stringify` (milestone **M6**, tuned for throughput in
**M7**) is implemented too — a block-style dumper with scalar quoting,
`Uint8Array` → `!!binary`, and anchor/alias emission for shared references and
cycles — so it now runs in the stringify benches/tests rather than being
skipped. `Candidate.stringify` stays optional in the registry (for a
hypothetical future candidate that can't dump), and we still never substitute
a foreign serializer for one that lacks it — but today every candidate,
including ours, provides one. A per-fixture capability probe
(`candidateHandles`) benchmarks it only on inputs it can read today — now the
JSON, block `yaml-plain`, **and** anchor/`!!binary` `yaml-rich` rows for both
`parse` and `stringify`, since both ops handle all three categories. Each
candidate's `kind` (`json` vs. `yaml`) decides which data categories it runs
on.

## Correctness — the consistency suite

Speed is meaningless if the output is wrong, so before the parser is trusted it
has to agree with a reference. We deliberately pick **one** oracle rather than
cross-checking every library against every other — they still legitimately
disagree on schema-typing edge cases, tag/anchor handling, and error
strictness (this is no longer a YAML-1.1-vs-1.2 split: js-yaml **v5**'s default
schema is now 1.2 core too, same as `yaml`): [`bench/oracle.ts`](bench/oracle.ts)
designates **`yaml`** — the more spec-compliant of the two reference libraries,
per the yaml-test-suite result above — as ground truth. It's the only
competitor we compare ourselves against for correctness. The oracle
normalizes `!!binary` to a portable plain `Uint8Array` (the library defaults to a
Node `Buffer`, which wouldn't deep-equal a spec-portable `Uint8Array`) and reads
with `maxAliasCount: -1` for the anchor-heavy rich fixtures.

`pnpm test` runs a [vitest](https://vitest.dev) suite over the same fixture data
the benchmarks use (up to 1 MB — the 10 MB `xlarge` case is skipped, too heavy
for an in-process oracle round-trip):

- **[`test/consistency.test.ts`](test/consistency.test.ts)** — for every fixture,
  `lightning-yaml.parse(text)` must deep-equal `oracle.parse(text)`, and — now
  that the dumper is implemented (M6; see also
  [`test/stringify.unit.ts`](test/stringify.unit.ts), `pnpm test:stringify`,
  **217/217 passing**) — `oracle.parse(lightning-yaml.stringify(value))` must
  deep-equal `value` too; we still don't substitute a foreign serializer for a
  candidate that lacks one. Rich fixtures additionally assert that
  `&anchor`/`*alias` reuse is reconstructed as **shared references**, not deep
  copies. Today the suite is **fully green** across all three categories — JSON,
  block `yaml-plain`, and `yaml-rich` alike, both parse and the now-active
  stringify round-trip; it stayed red on `yaml-rich` parse only until anchors +
  `!!binary` landed, and on the stringify round-trip only until the dumper (M6)
  landed.
- **[`test/parser.unit.ts`](test/parser.unit.ts)** — the parser's own fast
  node:test suite (`pnpm test:unit`, **364/364 passing**): exact `JSON.parse`
  parity on the JSON fixtures, an escape/unicode/bignum torture set,
  prototype-pollution and depth-guard security, a seeded block round-trip
  corpus, and a regression case for every adversarial-review finding.
- **[`test/fixtures.test.ts`](test/fixtures.test.ts)** — sanity checks on the
  fixtures and oracle themselves: they parse deterministically, JSON-compatible
  data round-trips, rich fixtures really do contain `!!binary`/anchors and plain
  ones don't. These **pass**, so a red consistency test unambiguously means "ours
  is wrong", not "the harness is broken".

The suite is not a benchmark and doesn't measure anything; it's the correctness
gate that makes the benchmark numbers meaningful.

## Running the benchmarks & tests

For contributors and the curious — how to reproduce the numbers and run the suites.

```bash
pnpm install
pnpm gen:fixtures       # generate bench/fixtures/data/* — JSON + YAML (gitignored, reproducible)

pnpm test               # vitest consistency suite (ours vs. the yaml oracle)
pnpm test:unit          # the parser's own node:test suite (fast, standalone)
pnpm test:suite         # yaml-test-suite conformance runner (364/373, 97.6%)

# low-level runners (all candidates by default; BENCH_SCOPE=competition|ours to filter)
pnpm bench:speed        # mitata parse + stringify throughput
pnpm bench:memory       # peak RSS + retained heap per candidate (sequential)

# report generators — refresh the BENCHMARKS.md results blocks
pnpm bench:self         # our implementation + JSON baseline (fast) — run before every commit/PR
pnpm bench:competition  # full head-to-head, all parsers (slow) — run on dep/dataset/milestone changes
pnpm bench              # gen:fixtures + competition + self

pnpm typecheck
```

The two report scripts refresh two different blocks in
[BENCHMARKS.md](BENCHMARKS.md) on two different cadences — see
[CLAUDE.md](CLAUDE.md):

- **`bench:self`** benchmarks only this repo's parser (+ JSON baseline) and is
  fast; run it before every commit to track our progress cheaply.
- **`bench:competition`** benchmarks the full matrix — every parser including
  lightning-yaml — and is slow (xlarge/yaml); re-run it when dependency versions,
  datasets, or (for a fresh head-to-head snapshot) our parser change.

The full result tables live in [BENCHMARKS.md](BENCHMARKS.md) and on
<https://lightning-yaml.dev>.

## Layout

```
src/
  index.ts             # the parser — parse/parseAll (M0–M5) + stringify (M6)
bench/
  candidates.ts        # candidates + groups + kind; applies/supports/handles gating
  oracle.ts            # the spec oracle (yaml) used by the fixtures + tests
  report.ts            # regenerate BENCHMARKS.md blocks: `report.ts self|competition`
  conformance/         # yaml-test-suite runner (`test:suite`) + compat cross-checks
  fixtures/
    datasets.ts        # dataset matrix (category × size × shape) + loaders
    generate.ts        # seeded, reproducible JSON + YAML generator
  speed/
    parse.bench.ts     # mitata parse throughput (sequential)
    stringify.bench.ts # mitata stringify throughput (sequential)
  memory/
    worker.ts          # one isolated (candidate,dataset,op) measurement
    run.ts             # sequential orchestrator + text/markdown formatters
  util/                # seeded PRNG + formatting helpers
test/
  consistency.test.ts  # ours vs. oracle over the benchmark data (fully green)
  parser.unit.ts       # the parser's own node:test suite (parity, torture, regressions)
  fixtures.test.ts     # fixture + oracle sanity (green)
  setup.global.ts      # ensures fixtures exist before the suite runs
vitest.config.ts
```

## Caveats

- The **JSON** fixtures are flow-style (valid YAML, but not block style); the
  **yaml-plain** and **yaml-rich** fixtures cover block style, so both views now
  exist. Rich fixtures are generated with the `yaml` library's 1.1 schema (that's
  what emits `!!binary`), and the `yaml` parser + oracle read them with
  `maxAliasCount: -1`, since the fixtures reuse anchors far past `yaml`'s default
  100-alias DoS cap — fine for trusted, self-generated data.
- For **rich** stringify, output differs by design (js-yaml emits `!!binary`;
  `yaml`, by default, re-emits a Uint8Array as a number sequence) — we're
  measuring each serializer on equivalent in-memory data, not byte-identical text.
- Peak RSS includes Node's fixed baseline, so peak-RSS ratios are conservative;
  the `heap Δ` column isolates the retained result size. At ~1 KB inputs heap Δ
  is dominated by GC noise (it can go negative) — trust peak RSS there.
