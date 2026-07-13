# Bundle-size benchmark

Measures how many kilobytes each YAML library adds to a **browser** bundle when an app
imports only `parse` + `stringify` and ships it minified — the third axis alongside the
speed and memory harnesses. Results land in the **Bundle size** block of the root
[`README.md`](../../README.md).

```bash
pnpm bench:bundlesize              # measure + rewrite the README block
node bench/bundlesize/run.mjs --no-readme   # measure + print only
node bench/bundlesize/run.mjs --verify      # also prove tree-shaking is real
```

## What it does

For each library × bundler it generates a tiny entry that imports **only** the two
public functions and pins them with a side-effecting global sink, then bundles it for
production and records the output's **raw minified**, **gzip** (level 9), and **brotli**
(quality 11) size. gzip is the compression virtually every HTTP server can apply on the
fly; brotli is what CDNs precompute for static assets.

```js
// generated entry (yaml shown)
import { parse, stringify } from "yaml";
globalThis.__lyBundleSink = [parse, stringify]; // keeps these two, DCEs the rest
```

`js-yaml` uses `load`/`dump`; `lightning-yaml` imports `parse`/`stringify` straight from
`src/index.ts` (it's private with no build, so it can't resolve as a bare specifier — and
bundling the source is exactly what a consumer's bundler would compile).

## Bundlers

| Bundler  | How it's driven                        | Minifier              |
| -------- | -------------------------------------- | --------------------- |
| Vite     | `build()` JS API (Rollup)              | terser                |
| Webpack  | Node API, `mode: "production"`         | terser (TerserPlugin) |
| Rolldown | `build()` JS API (Rust)                | built-in (oxc)        |
| Bun      | `bun build --minify` CLI               | built-in (native)     |
| Deno     | `deno bundle --minify` CLI (esbuild)   | built-in (esbuild)    |

All five run with **tree-shaking on**, **identifier mangling on**, and the **browser /
neutral platform** selected. Platform matters: `yaml@2`'s `.` export only offers a
`node` (CommonJS) condition and a `default` (ESM `browser/`) condition, and `js-yaml`'s
`.` export offers `import` (ESM) vs `require` (CJS). Bundling on the browser platform
selects the **ESM** builds, which tree-shake; a Node-platform bundle would pull the CJS
build and inflate every number, making the comparison unfair.

**Rolldown** stands in for the "Rust bundler" slot. Standalone **Turbopack** is omitted
deliberately: it has no library-bundling CLI — it only runs inside Next.js.

### Runtime bundlers (Bun, Deno)

Vite, Webpack, and Rolldown install as dev dependencies (below). **Bun** and **Deno** are
external runtimes: each row appears only if its binary is on `PATH` (or at
`~/.bun/bin/bun` / `~/.deno/bin/deno`); otherwise it's skipped with a note. To include the
Deno row: `curl -fsSL https://deno.land/install.sh | sh`.

## Reading the numbers

Because `lightning-yaml` is a single self-contained module, `parse` + `stringify` already
reach nearly all of it, so tree-shaking trims little (`--verify` shows ~1%) — that's
expected, not a bug. `yaml` and `js-yaml` are multi-module, so `--verify` shows larger
reductions there, confirming DCE is genuinely on. The five bundlers agree to within a few
percent per library; small spreads reflect each tool's minifier and runtime shim, not the
library.

## Dependency isolation

The bundler toolchain lives in **this directory's own `package.json`**, not the repo
root, so `pnpm install` for the parser stays lean and no `webpack.config`/`vite.config`
files pollute the tree (every bundler is configured inline in
[`bundlers.mjs`](./bundlers.mjs)). The runner installs these on first use; `node_modules`
here and all build output (under `results/bundlesize/`) are gitignored. The harness is
plain ESM (`.mjs`) on purpose — it stays out of `pnpm typecheck` so the heavy toolchain is
never required for the correctness gate.

Refresh the committed figures when the parser's `src` size changes materially, or when
`yaml` / `js-yaml` / a bundler version is bumped.
