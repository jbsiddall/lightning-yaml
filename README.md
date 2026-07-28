# ⚡ lightning-yaml

**Spec-compliant YAML parsing, out to give `JSON.parse` a run for its money.**

⚡ **~4× faster** and **~1–3× lighter** than js-yaml (bigger file, bigger gap) — with **near-`JSON.parse` memory** even at 10 MB. [See the benchmarks ↓](#benchmarks-at-a-glance)
<!-- bench:4ca6140 js-yaml:5.2.1 yaml:2.9.0 -->

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml/badge.svg)](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lightning-yaml.svg)](https://www.npmjs.com/package/lightning-yaml)

lightning-yaml is a pure-JS YAML 1.2 parser and stringifier that parses and
writes at speeds approaching native `JSON.parse`/`JSON.stringify` — while faithfully
implementing YAML 1.2, passing ~97.6% (364/373) of the official
[yaml-test-suite](https://github.com/yaml/yaml-test-suite). It's an API-level drop-in for either —
same exports and call signatures, ESM + CJS + full TypeScript types, and **zero
runtime dependencies**. No more trading YAML's readability for JSON's performance.

**Two goals, in priority order:** (1) full YAML 1.2 spec compliance, then
(2) speed and memory within reach of native `JSON.parse`/`JSON.stringify`.
Everything else is secondary to those two.

- **Fast.** Parses and stringifies at speeds approaching native
  `JSON.parse`/`JSON.stringify` — **~4× faster than js-yaml** on parse across our
  benchmark workloads.
  <!-- bench:4ca6140 js-yaml:5.2.1 -->
- **Spec-compliant.** Faithfully implements YAML 1.2 — passes ~97.6% (364/373) of
  the official yaml-test-suite.
- **Drop-in (API-level).** Same exports and signatures as `yaml` and `js-yaml` —
  swap the import and your code runs. An option we don't yet honour (`schema`,
  `sortKeys`, `indent`, …) **throws a clear error** rather than silently changing
  your output; see [Drop-in](#drop-in-for-js-yaml-or-yaml).
- **Lean.** Zero runtime dependencies, small bundle; ships ESM + CJS + full
  TypeScript types.
- **Complete.** Full YAML 1.2 core — flow & block syntax, anchors/aliases, tags
  incl. `!!binary`, multi-document streams, and more.

## Benchmarks at a glance

Measured primarily against native `JSON.parse` — the bar this project holds
itself to — with js-yaml and `yaml` for context. Representative figures on the
maintainer's machine; the full tables (all datasets, every parser, tracked over
time) live at [lightning-yaml.dev](https://lightning-yaml.dev), reading published
runs from the orphan `benchmark-data` branch.

| Representative metric      | `JSON.parse` | **lightning-yaml** |  js-yaml |    yaml |
| -------------------------- | -----------: | -----------------: | -------: | ------: |
| Parse — large records (× `JSON.parse`) |     1.0× |           **2.1×** |     8.9× |     107× |
| Peak RSS — 10 MB doc (× `JSON.parse`)   |     1.0× |           **1.4×** |     2.9× |     6.9× |
| Bundle — minified / gzip   |     _native_ |  **40 KB / 12 KB** | 52/16 KB | 96/29 KB |

<sub>Speed and memory are shown as ratios to `JSON.parse` — absolute ms/MB drift with the machine, but the relative cost doesn't (and peak memory is the stable figure). Numbers are from the newest run on the [`benchmark-data`](https://github.com/jbsiddall/lightning-yaml/tree/benchmark-data) branch — commit [`4ca6140`](https://github.com/jbsiddall/lightning-yaml/commit/4ca6140) (2026-07-23); js-yaml 5.2.1, `yaml` 2.9.0. Bundle sizes are deterministic.</sub>
<!-- bench:4ca6140 js-yaml:5.2.1 yaml:2.9.0 -->

So lightning-yaml stays within a small multiple of `JSON.parse`, where js-yaml and
`yaml` cost several to a hundred times more.

Full benchmarks (all datasets, every parser) →
[lightning-yaml.dev](https://lightning-yaml.dev)

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
> exports and signatures), so your code compiles and runs — but an option we
> don't yet honour (`schema`, `sortKeys`, `indent`, …) **throws** instead of
> silently leaving your output unchanged, so you find out at the call site (a
> boolean flag left at the value lightning-yaml already produces — usually
> `false` — still works).
> Full option compatibility is the goal; each shim's **option-support matrix**
> ([js-yaml](https://lightning-yaml.dev/api/js-yaml-compat/readme/#option-support-matrix),
> [yaml](https://lightning-yaml.dev/api/yaml-compat/readme/#option-support-matrix))
> lists which options are easy or hard to support next.

## Project priorities

In order:

1. **Compliance with the YAML 1.2 specification.** Correctness comes first,
   always — a fast parser that mis-reads your config is worthless. Where the spec
   itself is unclear, the [yaml-test-suite](https://github.com/yaml/yaml-test-suite)
   is our north star; where even that is ambiguous, we fall back to matching the
   behaviour of the `yaml` and js-yaml libraries. By default `parse` is lenient
   about a handful of spec-invalid inputs real-world YAML sometimes contains (see
   [Decisions and deviations](#decisions-and-deviations)); pass `{ strict: true }`
   for full YAML 1.2.2 rejection of those inputs too.
2. **Speed and memory within reach of native `JSON.parse` / `JSON.stringify`.**
   We'll never match native byte-for-byte, and we know it — but we treat that gap
   as a bug to shrink, chasing every last nanosecond so there's no performance
   reason left to reach for JSON over YAML.

Any sanctioned departure from these goals — anywhere lightning-yaml knowingly
differs from the spec or from `js-yaml` / `yaml` — is tracked in
[Decisions and deviations](#decisions-and-deviations) below.

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
- **Spot a claim that doesn't hold up?** If a benchmark looks wrong, a number or
  claim reads as inaccurate, or we're configuring js-yaml or `yaml` in a way
  that's unfair to them — where a fairer setup would make *them* look faster — I
  want to know. [Open an issue](https://github.com/jbsiddall/lightning-yaml/issues):
  benchmark honesty and accuracy matter more here than looking good, and I'll fix
  anything that's off.
- **Ideas, questions, or just want to chat?**
  [GitHub Discussions](https://github.com/jbsiddall/lightning-yaml/discussions)
  is the place for anything that would make the library better.

I care a lot about making this the best YAML parser it can be, and I'll move
quickly on whatever you find.

**Sending a pull request?** See [CONTRIBUTING.md](CONTRIBUTING.md) — in short,
if you change anything under `src/`, run `pnpm changeset` to declare the version
bump; CI checks for it.

## Status & scope

YAML 1.2 core, feature-complete. lightning-yaml also resolves `<<` merge keys
([`tag:yaml.org,2002:merge`](https://yaml.org/type/merge.html)) by default — a
YAML 1.1 construct outside the 1.2.2 core schema this project otherwise
targets, implemented as a deliberate extension because real-world YAML
depends on it so heavily (see "Decisions and deviations" below).

lightning-yaml passes **~97.6% of the official yaml-test-suite** (364/373) — a
faithful implementation of YAML 1.2 core. The handful of remaining failures
are unrelated spec edge cases (the suite doesn't exercise `<<`, so merge keys
never move this number).

## Decisions and deviations

The **single, authoritative list** of places lightning-yaml knowingly departs
from the YAML 1.2 spec, or from how `js-yaml` / `yaml` behave — kept here, in the
open, so every exception stays visible rather than buried in a code comment. If
lightning-yaml differs from the spec or another library in a way **not** listed
here, treat it as a bug and
[open an issue](https://github.com/jbsiddall/lightning-yaml/issues).

- **Lenient by default: a tab used as block indentation is tolerated, not
  rejected.** [YAML 1.2.2 §6.1](https://yaml.org/spec/1.2.2/#61-indentation-spaces)
  forbids tabs in a block collection's indentation, but real-world YAML sometimes
  has them, so `parse`/`parseAll` accept it by default. Pass `{ strict: true }`
  to reject that input instead, matching the spec (and the `yaml`/js-yaml
  libraries) exactly:
  ```ts
  const withTab = "a:\n\tb: 1\n"; // a tab indenting "b"

  parse(withTab); // { a: { b: 1 } } — accepted by default
  parse(withTab, { strict: true }); // throws: spec-invalid indentation
  ```
- **Duplicate mapping keys: last one wins.** The spec makes a duplicate key an
  error; we keep the last instead, matching `JSON.parse` — `{a: 1, a: 2}` parses
  to `{a: 2}`.
- **Merge keys (`<<`) are implemented, and merge BY DEFAULT.** `<<` is a
  [YAML 1.1 type](https://yaml.org/type/merge.html), not part of the 1.2.2
  core schema this project otherwise targets — so supporting it at all is a
  deliberate extension beyond that scope, made because real-world YAML leans
  on it heavily:
  ```yaml
  defaults: &d
    adapter: postgres
    host: localhost
  development:
    <<: *d
    database: dev_db
  ```
  ```ts
  parse(theYamlAbove).development;
  // { adapter: "postgres", host: "localhost", database: "dev_db" }
  ```
  Both js-yaml and `yaml` instead require an explicit opt-in and merge nothing
  by default, so defaulting to on is a divergence from **both** peers, chosen
  because the shape above is common enough in real-world YAML to be worth it.
  Pass `{ merge: false }` to restore the pre-merge reading (`<<` becomes an
  ordinary literal `"<<"` string key, neither expanded nor rejected) — the
  `lightning-yaml/js-yaml` and `lightning-yaml/yaml` compat shims default to
  exactly that, so they stay byte-faithful to the libraries they stand in for
  (`lightning-yaml/yaml` accepts `{ merge: true }` to opt back in; the
  js-yaml shim has no such opt-in — see its module doc). Two `<<` keys in one
  mapping resolve in **declaration order** (earlier wins on an overlapping
  key) — the opposite of the last-wins duplicate-key rule just above, but
  what both peer libraries do, so we match them.
- **A quoted or tagged merge key is an ordinary key.** Merging is decided by how
  the key is *written*, not by what it resolves to — so `"<<"`, `'<<'` and
  `!!str <<` all stay a literal `"<<"` key rather than merging, because an
  explicit quote or `!!str` makes them strings, which cannot resolve to the
  merge tag. An anchor is not a style, so `&k <<` still merges. js-yaml agrees
  on all of these; the `yaml` library merges a tagged `!!str <<` anyway, and we
  deliberately don't follow it there:
  ```yaml
  base: &b { host: localhost }
  a:
    <<: *b          # merged
  b:
    !!str <<: *b    # NOT merged — stays a literal "<<" key (yaml merges this)
  ```
- **An anchor on a merge key resolves to the literal `"<<"`.** Anchoring the
  merge key itself and referring to it later — `&k <<: *defaults` then `*k`
  somewhere else — gives you the string `"<<"` here. Both js-yaml and `yaml`
  instead hand back the internal symbol they resolve `<<` to, and there is no
  way for us to match that even in principle: the two libraries use *different*
  symbols, neither is registered (so neither is comparable across realms), and
  `yaml` doesn't export its one at all. Their symbol also can't survive a
  round-trip — feed either library's own output back to its own `stringify`
  and it throws. A plain string keeps the value JSON-representable and
  round-trippable, which matters more here than copying a leaked internal.
- **Compat options that aren't implemented yet throw.** The
  `lightning-yaml/js-yaml` and `lightning-yaml/yaml` shims take the same options
  (`schema`, `sortKeys`, `indent`, …) so your code compiles, but an option we
  can't yet honour throws a clear error naming it — rather than silently leaving
  the output unchanged. A boolean flag left at the value lightning-yaml already
  produces (e.g. `mapAsMap: false`) still works; any other value throws. This
  covers `yaml`'s `JSON.stringify`-style positional indent shorthand too —
  `stringify(value, 4)` or `stringify(value, replacer, 4)` — where a number or
  string throws even for a width real `yaml` would quietly clamp to its own
  default rather than honour — e.g. a negative number.
- **YAML 1.2 core schema, not 1.1.** Plain `yes`/`no`/`on`/`off` stay strings (not
  booleans) and there are no base-60 numbers, so results can differ from js-yaml's
  1.1-flavoured default. YAML 1.1 is a non-goal.
- **Implicit flow-collection keys are rejected.** Input like `{[1, 2]: v}` — a
  sequence used as a mapping key — is an error here, matching the spec; the `yaml`
  library accepts it, and we deliberately don't.
- **Malformed directives are rejected, where `yaml` is lenient.** A repeated
  `%TAG` for the same handle, and a `%YAML` directive with a higher major version
  (e.g. `%YAML 2.0`), are errors here — matching the spec
  ([§6.8.2](https://yaml.org/spec/1.2.2/#682-tag-directives) /
  [§6.8.1](https://yaml.org/spec/1.2.2/#681-yaml-directives)) and js-yaml. The
  `yaml` library instead keeps the last `%TAG` and only warns on the version
  (still parsing); we deliberately reject both.

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

- **[lightning-yaml.dev →](https://lightning-yaml.dev)** — guides, benchmarks, the
  full API reference, and the design write-ups.
- **[Try it live →](https://lightning-yaml.dev/playground)** — paste in YAML or
  JSON and see what lightning-yaml produces, side by side with js-yaml and
  `yaml`.
