# ⚡ lightning-yaml

**Fast YAML parsing that just works, out to give `JSON.parse` a run for its money.**

⚡ **~4× faster** and **~1–3× lighter** than js-yaml (bigger file, bigger gap) — with **near-`JSON.parse` memory** even at 10 MB. [See the benchmarks ↓](#benchmarks-at-a-glance)
<!-- bench:4ca6140 js-yaml:5.2.1 yaml:2.9.0 -->

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml/badge.svg)](https://github.com/jbsiddall/lightning-yaml/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lightning-yaml.svg)](https://www.npmjs.com/package/lightning-yaml)

lightning-yaml is a pure-JS YAML 1.2 parser and stringifier that parses and
writes at speeds approaching native `JSON.parse`/`JSON.stringify`, and takes the YAML
people actually write as-is. Strict YAML 1.2.2 checking is opt-in
(`{ strict: true }`); the parser scores ~98.4% (367/373) on the official
[yaml-test-suite](https://github.com/yaml/yaml-test-suite). It includes partial
compatibility shims for common `yaml` and `js-yaml` calls (they target exact
compatibility), ESM + CJS,
TypeScript types, and **zero runtime dependencies**. See the module references
for the supported calls and current gaps.
<!-- js-yaml:5.4.3 yaml:2.9.0 ly:fc982a72 -->

**Priorities, in order:** compatibility shims match their library exactly, then the
native API is fast, lean and just works, then strict YAML 1.2.2 checking is
opt-in. See [Project priorities](#project-priorities).

- **Fast.** Parses and stringifies at speeds approaching native
  `JSON.parse`/`JSON.stringify` — **~4× faster than js-yaml** on parse across our
  benchmark workloads.
  <!-- bench:4ca6140 js-yaml:5.2.1 -->
- **Strict checking, opt-in.** `parse(text, { strict: true })` checks YAML 1.2.2;
  the parser scores ~98.4% (367/373) on the official yaml-test-suite.
  <!-- ly:fc982a72 -->
- **Compatibility shims.** Common calls are available through `lightning-yaml/yaml`
  and `lightning-yaml/js-yaml`. The shims support selected calls and options;
  unsupported options throw instead of being silently ignored. See
  [Compatibility](#compatibility-with-js-yaml-or-yaml) for details.
- **Lean.** Zero runtime dependencies, small bundle; ships ESM + CJS + TypeScript
  types.
- **Broad YAML 1.2 support.** Handles flow and block syntax, anchors/aliases,
  tags including `!!binary`, and multi-document streams. The official suite
  tracks remaining spec edge cases.

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
features: [fast, spec-compliant, compat-shims]
`);
// → {
//     name: 'lightning-yaml',
//     version: '0.1.0',
//     features: ['fast', 'spec-compliant', 'compat-shims'],
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

<a id="drop-in-for-js-yaml-or-yaml"></a>

### Compatibility with `js-yaml` or `yaml`

The shims expose selected entry points under separate subpaths; check their
supported calls and options before switching.

```ts
// Coming from js-yaml — comment out the old import:
// import { load, dump } from 'js-yaml';
import { load, dump } from 'lightning-yaml/js-yaml';

// Using the `yaml` package:
// import { parse, stringify } from 'yaml';
import { parse, stringify } from 'lightning-yaml/yaml';
```

> **Status — partial compatibility.** The shims target exact compatibility with the
> libraries they replace, but today the subpaths provide selected functions,
> not the full `yaml` or `js-yaml` export surfaces or every call signature.
> Unsupported options throw instead of being silently ignored. Each shim's
> **option-support matrix**
> ([js-yaml](https://lightning-yaml.dev/api/js-yaml-compat/readme/#option-support-matrix),
> [yaml](https://lightning-yaml.dev/api/yaml-compat/readme/#option-support-matrix))
> lists which options are easy or hard to support next.
<!-- js-yaml:5.4.3 yaml:2.9.0 ly:6598b78 -->

## Project priorities

In order (higher numbers yield to lower ones on conflict):

1. **Compatibility layers behave exactly like the libraries they replace.**
   `lightning-yaml/js-yaml` and `lightning-yaml/yaml` should give the same output
   for the same input as the library they replace, edge cases included. Every
   function a shim exposes must be fully supported, and an argument a shim does
   not support throws a clear error rather than being silently ignored. The
   target is effectively 100% js-yaml compatibility; for `yaml`, the target is the
   subset of its API used by the VS Code YAML language server. Both are **partial
   today** (see [Compatibility](#compatibility-with-js-yaml-or-yaml)). Any
   difference from the library needs an owner-approved entry in
   [Decisions and deviations](#decisions-and-deviations).
2. **The native lightning-yaml API: fast, then lean on memory, and it just
   works.** It is not bound to any library's behaviour. It accepts YAML as people
   write it and does no validation you would not expect. Targets, not yet
   shipped: merge keys (`<<`) expand the way older Docker Compose files expect,
   and raw control characters are allowed by default (draft PR #338).
3. **Strict YAML 1.2.2 checking is an explicit opt-in, never the default.**
   Ask for it with `parse(text, { strict: true })`, or with a compat layer's
   schema option set to `strict`/`core` where that option is supported.
4. **Everything else: common sense.**

Any sanctioned departure from these priorities is tracked in
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

### Compatibility testing

Install once with `pnpm install --frozen-lockfile --strict-peer-dependencies`.
`pnpm test` runs the deterministic compatibility and project tests without
network access or candidate preparation. `pnpm test:properties` runs the focused
compatibility checks; `pnpm test:coverage` adds the node assertions, an HTML
Vitest report, and V8 coverage of every production `src/**/*.ts` file. Reports
are written to `results/compatibility/`; CI uploads them as an artifact.

Run `pnpm gen:suite` and `pnpm audit:js-yaml:full` for the deterministic
js-yaml 5.4.3 comparison campaign. It compares parsed JavaScript values, types
and reference sharing, and reports stringify byte equality separately from
semantic round-trip equality. The finite boolean/quote-style matrix is enumerated;
other options, callbacks and YAML inputs are sampled. The audit records existing
compatibility gaps; `pnpm audit:js-yaml:strict` makes gaps fail the command.
<!-- js-yaml:5.4.3 ly:5caa2c8 -->
Run `pnpm audit:yaml:full` for the separate yaml 2.9.0 campaign, including
`parse`, `stringify`, document conversions, callbacks and option witnesses.
Document AST and API differences are reported separately from converted values.
The main package includes the yaml-compatible `Lexer`, `Parser`, and `CST`
helper namespace for source token inspection and editing. The historical
`pnpm gen:yaml-cst-candidate` / `pnpm test:yaml-cst` campaign still targets the
pinned, unmerged [PR #184](https://github.com/jbsiddall/lightning-yaml/pull/184)
candidate and its broader Document/node work; it does not describe the current
main package. Composer, AST nodes, source-aware Document integration,
`keepSourceTokens` parse-option support, and complete language-server
compatibility remain absent.
See [the compatibility guide](docs/compatibility-testing.md) for scope,
replay and report interpretation. Neither sampled compatibility percentages nor
line coverage establish equivalence for every possible input.

## Status & scope

The parser supports YAML 1.2 core features including block scalars,
anchors/aliases, and tags such as `!!binary`. Merge keys (`<<`) are read as
ordinary string keys today, not expanded; the target for the native API is to
expand them, Docker Compose style. For raw control characters in quoted scalars,
the target is to allow them by default and reject them under `strict: true`; that
is implemented in draft PR #338, not yet merged.
Remaining YAML 1.2 spec edge cases are tracked through the official suite and
follow-up issues.

On the pinned official yaml-test-suite snapshot (`data-2022-01-17`), source
`fc982a72` scored **367/373 (98.4%)**, with comparison runs against js-yaml
5.4.3 and yaml 2.9.0. The remaining suite failures are YAML 1.2 spec edge
cases; the suite does not exercise merge keys (`<<`).
<!-- ly:fc982a72 -->

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
- **Merge keys (`<<`) are read as an ordinary key, not merged (current status, not a final decision; native expansion is the target).** `<<: *anchor`
  gives you a literal `"<<"` string key rather than merging the aliased map in.
  The installed js-yaml 5.4.3 and `yaml` 2.9.0 defaults also leave it literal.
  It's neither expanded nor rejected today; the shims are expected to stay literal to match their libraries.
  <!-- js-yaml:5.4.3 yaml:2.9.0 ly:67d2e0b -->
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
