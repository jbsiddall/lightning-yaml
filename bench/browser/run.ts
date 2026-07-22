/**
 * Browser speed-benchmark driver. Builds the bundle, serves it + the
 * fixtures, launches a real browser via playwright-core (launcher only —
 * mitata inside the page is what actually measures), waits for the in-page
 * run to finish, and writes results/benchmarks/browser-speed-<engine>.yaml —
 * one `suite: speed` document per engine, in the exact shape
 * bench/speed/emit.ts writes for the Node suite, so CI can `cat`-append it
 * onto benchmark-data's speed.yaml alongside the Node run.
 *
 *   node --import tsx bench/browser/run.ts chromium
 *   node --import tsx bench/browser/run.ts webkit    # errors locally — see engines.ts
 *
 * Env:
 *   BENCH_SOURCE              provenance string for the doc's `source` field (default: git sha)
 *   LIGHTNING_YAML_CHROMIUM_PATH  override the chromium executable/dir (default: /opt/pw-browsers/chromium)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stringify as toYaml } from "yaml";
import { candidates, libraryMeta, scopeLabel } from "../candidates.ts";
import { SpeedDocSchema } from "../schemas.ts";
import type { WorkloadRow } from "../util/mitataTrial.ts";
import { buildBrowserBundle } from "./build.ts";
import { assertFixturesGenerated, startServer } from "./server.ts";
import { isEngineName, launchEngine, type EngineName } from "./engines.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // repo root
const WALL_CLOCK_TARGET_MS = 15 * 60 * 1000; // design target for the full local chromium run
const PAGE_WAIT_TIMEOUT_MS = 20 * 60 * 1000; // hard safety cap, independent of the soft target above

interface PageResult {
  operations: { parse: WorkloadRow[]; stringify: WorkloadRow[] };
  usedCandidates: string[];
  timerResolutionMs: number;
  crossOriginIsolated: boolean;
  skippedFixtures: { name: string; bytes: number }[];
}

/**
 * Shape of the page's globals, for typechecking the `page.evaluate()`/
 * `page.waitForFunction()` closures below. This file runs under Node (no DOM
 * lib in the root tsconfig — see bench/browser/tsconfig.json, which covers
 * only the files that actually execute in a browser), so this is a plain
 * file-local ambient binding rather than a `declare global` DOM augmentation:
 * playwright serializes these closures to run in the page, but TypeScript
 * only needs them to typecheck textually within this file's own scope.
 */
declare const window: {
  __BENCH_RESULT__?: PageResult;
  __BENCH_DONE__?: boolean;
  __BENCH_ERROR__?: string;
};

function gitShaOr(fallback: string): string {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  return sha || fallback;
}

function outPathFor(engine: EngineName): string {
  return join(ROOT, "results", "benchmarks", `browser-speed-${engine}.yaml`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || !isEngineName(arg)) {
    console.error("usage: node --import tsx bench/browser/run.ts <chromium|webkit>");
    process.exit(1);
  }
  const engineName: EngineName = arg;
  const start = Date.now();

  await assertFixturesGenerated();

  console.log("Building browser bundle…");
  const { manifest, bundleBytes } = await buildBrowserBundle();
  console.log(`  bundle: ${(bundleBytes / 1024).toFixed(0)} KB, ${manifest.included.length} fixtures included`);
  if (manifest.skipped.length > 0) {
    for (const s of manifest.skipped) {
      console.log(`  skipped (over budget): ${s.name} (${(s.bytes / 1024 / 1024).toFixed(1)} MB target)`);
    }
  } else {
    console.log("  skipped: none");
  }

  const server = await startServer();
  console.log(`Serving harness at ${server.url}`);

  console.log(`Launching ${engineName}…`);
  const { browser, family } = await launchEngine(engineName);
  const browserVersion = browser.version();
  console.log(`  ${family} ${browserVersion}`);

  try {
    const page = await browser.newPage();
    page.on("console", (msg) => console.log(`  [page] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`  [page error] ${err}`));

    await page.goto(server.url, { waitUntil: "load" });

    console.log("Running in-page benchmarks (this can take several minutes)…");
    // NOTE: `waitForFunction`'s 2nd positional param is `arg` (passed into the
    // predicate), NOT options — `options` is 3rd. Passing `{ timeout }` as the
    // 2nd arg compiles fine (`arg?: any`) but silently falls back to
    // playwright's 30s default, which is nowhere near enough for a multi-
    // minute benchmark run. Caught by an actual end-to-end run, not typecheck.
    await page.waitForFunction(() => window.__BENCH_DONE__ === true, undefined, { timeout: PAGE_WAIT_TIMEOUT_MS });

    const pageError = await page.evaluate(() => window.__BENCH_ERROR__);
    if (pageError) throw new Error(`in-page benchmark failed:\n${pageError}`);

    const result = (await page.evaluate(() => window.__BENCH_RESULT__)) as PageResult | undefined;
    if (!result) throw new Error("page reported done but __BENCH_RESULT__ is missing");

    const quantumMs = result.timerResolutionMs;
    const isCoarse = !Number.isFinite(quantumMs) || quantumMs > 0.01; // >10µs
    console.log(
      `Timer: crossOriginIsolated=${result.crossOriginIsolated}, ` +
        `resolution≈${Number.isFinite(quantumMs) ? `${(quantumMs * 1000).toFixed(2)}µs` : "unmeasured"}` +
        (isCoarse ? " (coarse)" : " (fine)"),
    );
    if (isCoarse) {
      // mitata's public bench()/group()/run() API (what this harness and the
      // Node speed suite both use) exposes no per-bench min-time/batch-size
      // override — only the lower-level, unused-here `measure()` does. The
      // safety net is mitata's own default per-bench floor (~642ms of
      // accumulated sample time; bench/../node_modules/mitata/src/lib.mjs
      // `k_min_cpu_time`), which at a 100µs quantum already gives ~6400x
      // margin over the 100x this task's design contract asks for — so a
      // coarse quantum is logged, not compensated for by hand.
      console.log("  (no mitata knob to raise batch size for this; default min-sample-time already clears 100x margin)");
    }

    const usedNames = new Set(result.usedCandidates);
    const usedCandidates = candidates.filter((c) => usedNames.has(c.name));

    const now = new Date();
    const doc = {
      suite: "speed" as const,
      scope: scopeLabel("all"),
      tool: "mitata",
      unit: "ns/iter",
      lower_is_better: true,
      schema_version: 1,
      generated: now.toISOString().slice(0, 10),
      generated_at: now.toISOString(),
      source: process.env.BENCH_SOURCE ?? gitShaOr("local"),
      env: {
        // No os access from inside the page — clk/cpu are what mitata itself
        // could observe there, which is nothing (see design contract item 3).
        clk: "unknown",
        cpu: "unknown",
        runtime: `${family} ${browserVersion} (${process.arch}-${process.platform})`,
      },
      libraries: usedCandidates.map(libraryMeta),
      operations: result.operations,
    };

    SpeedDocSchema.parse(doc); // fail fast if the emitted doc doesn't match its schema
    const outPath = outPathFor(engineName);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, toYaml(doc));
    console.log(`Wrote ${outPath}`);

    const elapsedMs = Date.now() - start;
    console.log(`Total wall-clock: ${(elapsedMs / 1000).toFixed(1)}s`);
    if (elapsedMs > WALL_CLOCK_TARGET_MS) {
      console.warn(
        `WARNING: run took longer than the ~15 min target (${(elapsedMs / 60000).toFixed(1)} min). ` +
          `See the design contract's wall-clock note — reduce the fixture/candidate matrix if this persists.`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
