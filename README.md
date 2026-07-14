# ⚡ lightning-yaml

**Spec-compliant YAML parsing, out to give `JSON.parse` a run for its money.**

⚡ **~4× faster than js-yaml** · **near-`JSON.parse` memory** (≈1.3× even on a 10 MB document) — [see the benchmarks ↓](#benchmarks-at-a-glance)

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml/badge.svg)](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lightning-yaml.svg)](https://www.npmjs.com/package/lightning-yaml)

lightning-yaml is a pure-JS YAML 1.2 parser and stringifier that parses and
writes at speeds approaching native `JSON.parse`/`JSON.stringify` — while passing
~97.6% of the official [yaml-test-suite](https://github.com/yaml/yaml-test-suite),
ahead of js-yaml and the `yaml` library. It's an API-level drop-in for either —
same exports and call signatures, ESM + CJS + full TypeScript types, and **zero
runtime dependencies**. No more trading YAML's readability for JSON's performance.

**Two goals, in priority order:** (1) full YAML 1.2 spec compliance, then
(2) speed and memory within reach of native `JSON.parse`/`JSON.stringify`.
Everything else is secondary to those two.

- **Fast.** Parses and stringifies at speeds approaching native
  `JSON.parse`/`JSON.stringify` — **3–5× faster than js-yaml** on parse, across
  our benchmark workloads.
- **Spec-compliant.** Passes ~97.6% of the official yaml-test-suite — more than
  js-yaml or `yaml`.
- **Drop-in (API-level).** Same exports and signatures as `yaml` and `js-yaml` —
  swap the import and your code runs. Option arguments (`schema`, `sortKeys`,
  `indent`, …) are accepted-but-ignored today; see
  [Drop-in](#drop-in-for-js-yaml-or-yaml).
- **Lean.** Zero runtime dependencies, small bundle; ships ESM + CJS + full
  TypeScript types.
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
pnpm add lightning-yaml
npm install lightning-yaml
yarn add lightning-yaml
bun add lightning-yaml
```

**Browser / CDN** — no build step required:

```html
<script src="https://cdn.jsdelivr.net/npm/lightning-yaml/dist/lightning-yaml.min.js"></script>
<script>
  const data = YAML.parse('greeting: hello');
</script>
```

Or as modern ESM, straight from a CDN:

```js
import { parse } from 'https://cdn.jsdelivr.net/npm/lightning-yaml/+esm';
```

ESM, CommonJS, and TypeScript types all ship in the box.

## Quick start

```ts
import { parse, parseAll, stringify } from 'lightning-yaml';

parse(`
name: lightning-yaml
version: 0.1.0
features: [fast, spec-compliant, drop-in]
`);
// → {
//     name: 'lightning-yaml',
//     version: '0.1.0',
//     features: ['fast', 'spec-compliant', 'drop-in'],
//   }

stringify({ hello: 'world', list: [1, 2, 3] });
// → hello: world
//   list:
//     - 1
//     - 2
//     - 3

parseAll(`
---
a: 1
---
b: 2
`);
// → [{ a: 1 }, { b: 2 }]   ← multi-document streams
```

**Full API reference and function signatures →
[lightning-yaml.dev](https://lightning-yaml.dev)**

### Drop-in for `js-yaml` or `yaml`

Already using another YAML library? Swap one import, keep your code.

```ts
// Coming from js-yaml — comment out the old import:
// import { load, dump } from 'js-yaml';
import { load, dump } from 'lightning-yaml/js-yaml';

// Using the `yaml` library — same idea:
// import { parse, stringify } from 'yaml';
import { parse, stringify } from 'lightning-yaml/yaml';
```

> **Status — surface-level today.** The shims are a TypeScript drop-in (same
> exports and signatures), so your code compiles and runs — but option arguments
> (`schema`, `sortKeys`, `indent`, …) are currently **accepted-and-ignored**.
> Full option compatibility is the goal; the
> [compatibility matrix](https://lightning-yaml.dev) details which options are
> easy or hard to support next.

## Project priorities

In order:

1. **Compliance with the YAML 1.2 specification.** Correctness comes first,
   always — a fast parser that mis-reads your config is worthless. Where the spec
   itself is unclear, the [yaml-test-suite](https://github.com/yaml/yaml-test-suite)
   is our north star; where even that is ambiguous, we fall back to matching the
   behaviour of the `yaml` and js-yaml libraries.
2. **Speed and memory within reach of native `JSON.parse` / `JSON.stringify`.**
   Not parity — we'll never match native byte-for-byte, and we know it — but we
   treat that gap as a bug to shrink, chasing every last nanosecond so there's no
   performance reason left to reach for JSON over YAML.

## Contributing & feedback

lightning-yaml is young, and the single most useful thing you can do is **try it
and tell me what happens** — I'm hugely grateful to anyone who gives it a run.

- **Try to break it.** Find some YAML that crashes the parser, or that it reads
  in a way the YAML 1.2 spec doesn't? I'd be thrilled to hear about it —
  [open an issue](https://github.com/jbsiddall/lightning-yaml/issues) with the
  input and I'll be on it fast. Real-world edge cases are exactly what make this
  library better.
- **Slower than you expected?** If lightning-yaml is slower than another YAML
  parser on your data, slower than the benchmarks suggest, or just doesn't work
  in your environment, please
  [open an issue](https://github.com/jbsiddall/lightning-yaml/issues) — I'd
  genuinely love to dig into it.
- **Ideas, questions, or just want to chat?**
  [GitHub Discussions](https://github.com/jbsiddall/lightning-yaml/discussions)
  is the place for anything that would make the library better.

I care a lot about making this the best YAML parser it can be, and I'll move
quickly on whatever you find.

## Status & scope

YAML 1.2 core, feature-complete but for one deliberate gap — **merge keys
(`<<`)**. Today a `<<` key is read as an ordinary string key rather than being
merged (it's neither expanded nor rejected); everything else in the 1.2 core is
implemented.

lightning-yaml passes **~97.6% of the official yaml-test-suite** (364/373) —
ahead of both js-yaml and the `yaml` library. The handful of remaining failures
are unrelated spec edge cases, not merge keys (the suite doesn't exercise `<<`).

## Built with Claude Code

lightning-yaml is built with the help of
[Claude Code](https://www.anthropic.com/claude-code), but **every commit is
human-reviewed and I'm accountable for all of the code**. The aim is the leverage
of AI without a vibe-coded, unreviewed repo — the assistant helps write it, a
human owns it. You'll also see a steady stream of commits that do nothing but
tidy up: keeping the code human-readable and maintainable is an ongoing priority,
not an afterthought.

## License

[Apache License 2.0](LICENSE) — © 2026 Joseph Siddall.

---

## Design, benchmarks & internals

How lightning-yaml is built, measured, and tested — the benchmark methodology,
the separate peak-memory harness, the consistency suite, and the parser
internals — lives in the docs, so this README stays focused on *using* the
library:

- **[lightning-yaml.dev →](https://lightning-yaml.dev)** — guides, the full API
  reference, and the design write-ups.
- **[BENCHMARKS.md](BENCHMARKS.md)** — the complete, auto-generated benchmark
  tables (every dataset, every parser).
- **[Try it live →](https://lightning-yaml.dev/playground)** — paste in YAML or
  JSON and see what lightning-yaml produces, side by side with js-yaml and
  `yaml`.
