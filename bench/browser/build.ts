/**
 * Builds the browser benchmark bundle: derives the fixture manifest (Node
 * side, via bench/browser/manifest.ts) and esbuild-bundles entry.ts into a
 * self-contained ESM script. Both outputs are gitignored, regenerated on
 * every `pnpm bench:browser` run — see bench/browser/generated/.
 */

import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { buildManifest, type BrowserManifest } from "./manifest.ts";

const HERE = dirname(fileURLToPath(import.meta.url)); // bench/browser
const GENERATED = join(HERE, "generated");
export const BUNDLE_PATH = join(GENERATED, "bundle.js");

export interface BuildResult {
  manifest: BrowserManifest;
  bundlePath: string;
  bundleBytes: number;
}

export async function buildBrowserBundle(): Promise<BuildResult> {
  mkdirSync(GENERATED, { recursive: true });

  const manifest = buildManifest();

  const result = await esbuild.build({
    entryPoints: [join(HERE, "entry.ts")],
    outfile: BUNDLE_PATH,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    // The fixture manifest is a build-time literal substitution (see
    // entry.ts's `declare const __FIXTURE_MANIFEST__`), not a JSON file
    // import — that keeps entry.ts typecheckable without a generated file on
    // disk (bench/browser/generated/ is gitignored, only produced here).
    define: { __FIXTURE_MANIFEST__: JSON.stringify(manifest) },
    // mitata probes for a Bun/Node/optional-counters environment via dynamic
    // `import()`/`require()` of 'bun:jsc', 'node:v8', 'os', 'node:os', and the
    // optional '@mitata/counters' package — every call site is already
    // wrapped in a try/catch (or an `if (globalThis.Bun)` guard) upstream, so
    // it degrades gracefully at runtime once these fail to resolve; without
    // `external` esbuild tries to resolve them at BUILD time instead (none
    // exist for a browser target) and the bundle fails outright.
    external: ["bun:jsc", "node:v8", "node:os", "os", "@mitata/counters"],
    // Not minified: this bundle is measured for parse/stringify *speed*, not
    // shipped to users — bundle-size honesty lives in bench/bundlesize
    // instead (a separate, minified, tree-shaken measurement). Unminified
    // also keeps page-error stack traces readable when something breaks.
    minify: false,
    sourcemap: false,
    write: true,
    logLevel: "silent",
  });
  if (result.errors.length > 0) {
    throw new Error(`esbuild failed:\n${result.errors.map((e) => e.text).join("\n")}`);
  }

  return { manifest, bundlePath: BUNDLE_PATH, bundleBytes: statSync(BUNDLE_PATH).size };
}
