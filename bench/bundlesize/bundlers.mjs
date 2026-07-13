// Bundler adapters for the bundle-size benchmark.
//
// Each adapter bundles ONE generated entry (which imports only a library's
// parse + stringify) for PRODUCTION: tree-shaking on, true minification
// (whitespace + comments stripped, identifiers mangled), targeting the
// BROWSER/neutral platform so `yaml` and `js-yaml` resolve their ESM builds
// (their `.` exports otherwise fall back to CommonJS, which tree-shakes poorly
// and would make the comparison unfair — see bench/bundlesize/README.md).
//
// Contract: `run({ entryFile, outDir, rootDir })` writes exactly one JS file
// into `outDir` and returns its absolute path. Throwing is fine — the runner
// catches per (library, bundler) cell and records the failure. No adapter
// mutates shared state or the repo root.
//
// API bundlers (vite/webpack/rolldown) come from the nested
// bench/bundlesize/node_modules and are imported lazily so a missing install
// yields a clean "unavailable" instead of a crash at module load. CLI bundlers
// (bun/deno) are external runtimes, detected on PATH.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// The nested toolchain's node_modules — webpack resolves LOADERS relative to
// `context` (the repo root), so it must be told where esbuild-loader lives.
const NESTED_NM = fileURLToPath(new URL("./node_modules", import.meta.url));

/** Pick the single emitted JS file in a fresh out dir (ignores .map/.d.ts). */
function soleJsFile(outDir) {
  const hits = readdirSync(outDir).filter(
    (f) => (f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs")) && !f.endsWith(".d.ts"),
  );
  if (hits.length === 0) throw new Error(`no JS output in ${outDir}`);
  // If a bundler split anything out, take the largest (the entry chunk).
  hits.sort((a, b) => statSync(join(outDir, b)).size - statSync(join(outDir, a)).size);
  return join(outDir, hits[0]);
}

/** Resolve a CLI binary: PATH first, then common per-tool install dirs. */
export function resolveBin(name, extraCandidates = []) {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    encoding: "utf8",
  });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split("\n")[0];
  for (const c of extraCandidates) if (existsSync(c)) return c;
  return null;
}

// ── Vite (Rollup + terser) ─────────────────────────────────────────────────
async function viteBuild({ entryFile, outDir }) {
  const { build } = await import("vite");
  await build({
    configFile: false,
    logLevel: "silent",
    // Vite's default (client) build already targets the browser, so `yaml`
    // resolves its ESM `browser/` build and `js-yaml` its `.mjs`.
    build: {
      outDir,
      emptyOutDir: false,
      write: true,
      minify: "terser", // full mangling, not just whitespace
      target: "es2022",
      reportCompressedSize: false,
      // Library mode is the sanctioned way to bundle a bare JS entry (no HTML).
      // Vite uses this fileName verbatim, so include the extension. A single-entry
      // lib build emits one chunk, so no code-splitting/inlining option is needed.
      lib: { entry: entryFile, formats: ["es"], fileName: () => "vite-out.mjs" },
      // Rollup tree-shaking is on by default for production builds.
    },
  });
  return soleJsFile(outDir);
}

// ── Webpack (production: tree-shaking + TerserPlugin) ───────────────────────
async function webpackBuild({ entryFile, outDir, rootDir }) {
  const { default: webpack } = await import("webpack");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "production", // enables usedExports tree-shaking + Terser mangling
      target: "web",
      context: rootDir,
      entry: entryFile,
      output: { path: outDir, filename: "webpack-out.js", iife: true, module: false },
      resolve: {
        extensions: [".ts", ".mjs", ".js", ".json"],
        // Force ESM resolution of yaml/js-yaml (exclude the `node`/CJS branch).
        conditionNames: ["import", "browser", "module", "default"],
      },
      // esbuild-loader lives in the nested toolchain, not the repo root.
      resolveLoader: { modules: [NESTED_NM, "node_modules"] },
      module: {
        rules: [
          {
            test: /\.[cm]?ts$/,
            loader: "esbuild-loader",
            options: { target: "es2022", tsconfig: undefined },
          },
        ],
      },
      optimization: {
        minimize: true,
        usedExports: true,
        sideEffects: true,
        concatenateModules: true,
      },
      performance: { hints: false },
      infrastructureLogging: { level: "error" },
      stats: "errors-warnings",
    });
    compiler.run((err, stats) => {
      if (err) return reject(err);
      if (stats && stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true })));
      }
      compiler.close(() => resolve());
    });
  });
  return join(outDir, "webpack-out.js");
}

// ── Rolldown (Rust, oxc minifier) ──────────────────────────────────────────
async function rolldownBuild({ entryFile, outDir }) {
  const { build } = await import("rolldown");
  const outFile = join(outDir, "rolldown-out.js");
  await build({
    input: entryFile,
    platform: "browser", // ESM resolution of yaml/js-yaml
    output: { file: outFile, format: "esm", minify: true },
    // Rolldown tree-shaking is on by default.
  });
  return outFile;
}

// ── Bun (native bundler) ───────────────────────────────────────────────────
function bunBuild({ entryFile, outDir, rootDir, bin }) {
  const outFile = join(outDir, "bun-out.js");
  const r = spawnSync(
    bin,
    ["build", entryFile, "--minify", "--target", "browser", "--format", "esm", "--outfile", outFile],
    { cwd: rootDir, encoding: "utf8" }, // cwd=root so node_modules resolves
  );
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "bun build failed").trim());
  return outFile;
}

// ── Deno (esbuild-backed `deno bundle`) ────────────────────────────────────
function denoBuild({ entryFile, outDir, rootDir, bin }) {
  const outFile = join(outDir, "deno-out.js");
  const r = spawnSync(
    bin,
    [
      "bundle",
      "--platform",
      "browser", // ESM resolution
      "--minify",
      "--packages",
      "bundle", // inline npm deps
      "--output",
      outFile,
      entryFile,
    ],
    {
      cwd: rootDir, // package.json + node_modules here → bare specifiers resolve
      encoding: "utf8",
      env: { ...process.env, DENO_NO_UPDATE_CHECK: "1" },
    },
  );
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "deno bundle failed").trim());
  return outFile;
}

/**
 * The bundler registry. `available()` returns the resolved binary (CLI) or
 * true (API), or null when the bundler can't run here (→ skipped with a note).
 */
export const BUNDLERS = [
  { name: "vite", rust: false, run: viteBuild, available: () => true },
  { name: "webpack", rust: false, run: webpackBuild, available: () => true },
  { name: "rolldown", rust: true, run: rolldownBuild, available: () => true },
  {
    name: "bun",
    rust: false,
    run: bunBuild,
    available: () => resolveBin("bun", [join(homedir(), ".bun/bin/bun")]),
  },
  {
    name: "deno",
    rust: true,
    run: denoBuild,
    available: () => resolveBin("deno", [join(homedir(), ".deno/bin/deno")]),
  },
];
