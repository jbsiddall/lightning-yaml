/**
 * Browser memory-RATIO driver (issue #107 Phase 3) — publishes RATIOS ONLY,
 * normalized to lightning-yaml = 1.0, never absolute bytes (see CLAUDE.md's
 * benchmark-integrity rule). Two engines, two different measurement methods,
 * because a browser page can't observe its own process's RSS and webkit
 * exposes no in-page heap API — see bench/schemas.ts's MemoryRatiosDocSchema
 * doc comment for what each measures and why they aren't directly comparable:
 *
 *   - chromium (method "heap-delta", higher confidence): in-page
 *     `performance.memory.usedJSHeapSize` growth while retaining K parsed
 *     results, gc()'d before/after. Reuses the speed harness's bundling/
 *     server/engine-resolution infrastructure (build.ts, server.ts,
 *     engines.ts) — see bench/browser/memory/ for what's specific to memory.
 *   - webkit (method "peak-rss", lower confidence): kernel VmHWM of the
 *     WebKitWebProcess child during the same retained-parse batch, read via
 *     bench/browser/memory/proc.ts. Doesn't run locally (no webkit binary in
 *     this environment — see engines.ts's WEBKIT_INSTALL_HINT); its /proc
 *     mechanics are smoke-tested against Chromium's renderer instead — see
 *     bench/browser/memory/procSmoke.ts.
 *
 * Every library gets its OWN esbuild bundle (bench/browser/memory/entries/)
 * and its own fresh browser — no cross-library heap pollution — built and
 * launched one at a time (never in parallel; matches every other harness in
 * this repo's "sequential, so RSS/heap readings can't corrupt each other"
 * rule, see CLAUDE.md's Benchmarking rules).
 *
 *   node --import tsx bench/browser/memoryRun.ts chromium
 *   node --import tsx bench/browser/memoryRun.ts webkit    # errors locally — see engines.ts
 *
 * Env:
 *   BENCH_SOURCE      provenance string for the doc's `source` field (default: git sha)
 *   BENCH_MEM_ITERS   K, parses retained per fixture (default 60 — see the
 *                     module-level ITERS comment for why).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stringify as toYaml } from "yaml";
import type { Page } from "playwright-core";
import { MemoryRatiosDocSchema } from "../schemas.ts";
import { buildBrowserBundle } from "./build.ts";
import { assertFixturesGenerated, startServer } from "./server.ts";
import { isEngineName, launchEngine, launchEngineWithProcess, type EngineName } from "./engines.ts";
import { memoryRatioFixtures, SKIPPED_FIXTURES, type MemoryFixture } from "./memory/manifest.ts";
import { memoryRatioLibraries, type MemoryRatioLibrary } from "./memory/libraries.ts";
import { findUniqueDescendant, readVmHwmBytes, resetPeakRss, waitForRssStabilization } from "./memory/proc.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // repo root
const GENERATED_DIR = join(ROOT, "bench", "browser", "generated");

// K: retained-parse count per fixture. Chosen empirically against a real
// local Chromium run: K=40 cleared the noise floor comfortably for every
// fixture except the smallest (~1 KB text, so a tiny parsed-object graph —
// its retained batch is small enough that leftover GC/sweep work from a
// preceding large fixture could swing its net delta negative). K=60 plus
// two fixes below closed that gap: fixtures now run smallest-tier-first
// (manifest.ts) so a big fixture's GC residue never lands on a small one's
// reading, and __memReadHeap does two gc() passes with a settle gap
// (pageHarness.ts) instead of one. Bigger K would widen the margin further
// at the cost of longer runs and more retained memory per large fixture —
// K=60 keeps a ~1 MB fixture's batch in the tens-of-MB range, not hundreds.
export const ITERS = Number(process.env.BENCH_MEM_ITERS) || 60;

const CHROMIUM_MEMORY_ARGS = ["--enable-precise-memory-info", "--js-flags=--expose-gc"];

function gitShaOr(fallback: string): string {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  return sha || fallback;
}

function outPathFor(engine: EngineName): string {
  return join(ROOT, "results", "benchmarks", `memory-ratios-${engine}.yaml`);
}

interface LibraryFixtureDeltas {
  [libraryId: string]: { [fixtureName: string]: number };
}

// ---------------------------------------------------------------------------
// Chromium leg — in-page heap-delta.
// ---------------------------------------------------------------------------

declare const window: {
  __memParseAndRetain?: (url: string, category: string, iters: number) => Promise<number>;
  __memDropRetained?: () => number;
  __memReadHeap?: () => number;
};

async function readHeap(page: Page): Promise<number> {
  return page.evaluate(() => window.__memReadHeap!());
}

async function runChromiumLeg(
  libraries: MemoryRatioLibrary[],
  fixtures: MemoryFixture[],
): Promise<{ runtime: string; deltas: LibraryFixtureDeltas }> {
  const deltas: LibraryFixtureDeltas = {};
  let runtime = "";

  for (const lib of libraries) {
    console.log(`[chromium] ${lib.id}: building isolated bundle…`);
    const { bundlePath } = await buildBrowserBundle({
      entryPoint: lib.entryPoint,
      outFile: join(GENERATED_DIR, `memory-${lib.id}.js`),
    });
    const server = await startServer(bundlePath);
    const { browser } = await launchEngine("chromium", CHROMIUM_MEMORY_ARGS);
    runtime ||= `chromium ${browser.version()} (${process.arch}-${process.platform})`;

    try {
      const page = await browser.newPage();
      page.on("pageerror", (err) => console.error(`  [page error] ${err}`));
      await page.goto(server.url, { waitUntil: "load" });

      // Noise floor: two gc()'d reads with nothing happening between them —
      // subtracted from every fixture's delta below (design contract item 3).
      await readHeap(page);
      const noiseBefore = await readHeap(page);
      const noiseAfter = await readHeap(page);
      const emptyPageDeltaBytes = noiseAfter - noiseBefore;

      deltas[lib.id] = {};
      for (const fx of fixtures) {
        const before = await readHeap(page);
        await page.evaluate(
          ([url, category, iters]) => window.__memParseAndRetain!(url as string, category as string, iters as number),
          [fx.url, fx.category, ITERS],
        );
        const after = await readHeap(page);
        const dropped = await page.evaluate(() => window.__memDropRetained!());
        if (dropped !== ITERS) {
          throw new Error(`${lib.id} / ${fx.name}: only ${dropped}/${ITERS} retained results survived to the drop — page reloaded or crashed mid-batch, reading invalid`);
        }
        const net = after - before - emptyPageDeltaBytes;
        deltas[lib.id][fx.name] = net;
        console.log(`  ${lib.id} / ${fx.name}: Δheap=${(net / 1024).toFixed(1)} KB (raw ${((after - before) / 1024).toFixed(1)} KB, noise floor ${emptyPageDeltaBytes} B)`);
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }

  return { runtime, deltas };
}

// ---------------------------------------------------------------------------
// Webkit leg — out-of-process peak-RSS via /proc. Doesn't run locally (see
// module doc); mechanics smoke-tested against Chromium in procSmoke.ts.
// ---------------------------------------------------------------------------

const WEBPROCESS_CMDLINE_NEEDLE = "WebKitWebProcess";
const STABILIZATION_OPTS = { tolerance: 0.01, requiredSamples: 3, intervalMs: 200, timeoutMs: 10_000 };

/** One (library, fixture, iters) measurement: fresh page, fresh clear_refs reset, VmHWM peak during the batch. */
async function measureWebkitBatch(
  browser: Awaited<ReturnType<typeof launchEngineWithProcess>>["browser"],
  browserPid: number,
  serverUrl: string,
  fx: { url: string; category: string },
  iters: number,
): Promise<number> {
  const page = await browser.newPage();
  try {
    await page.goto(serverUrl, { waitUntil: "load" });
    const webProcessPid = findUniqueDescendant(browserPid, WEBPROCESS_CMDLINE_NEEDLE);
    await waitForRssStabilization(webProcessPid, STABILIZATION_OPTS);
    resetPeakRss(webProcessPid); // VmHWM now reads as "current RSS" (see proc.ts's doc comment).
    const baseline = readVmHwmBytes(webProcessPid);
    await page.evaluate(
      ([url, category, n]) => window.__memParseAndRetain!(url as string, category as string, n as number),
      [fx.url, fx.category, iters],
    );
    const peak = readVmHwmBytes(webProcessPid);
    const dropped = await page.evaluate(() => window.__memDropRetained!());
    if (dropped !== iters) {
      throw new Error(`only ${dropped}/${iters} retained results survived to the drop — page reloaded or crashed mid-batch, reading invalid`);
    }
    return peak - baseline;
  } finally {
    await page.close();
  }
}

async function runWebkitLeg(
  libraries: MemoryRatioLibrary[],
  fixtures: MemoryFixture[],
): Promise<{ runtime: string; deltas: LibraryFixtureDeltas }> {
  const deltas: LibraryFixtureDeltas = {};
  let runtime = "";

  for (const lib of libraries) {
    console.log(`[webkit] ${lib.id}: building isolated bundle…`);
    const { bundlePath } = await buildBrowserBundle({
      entryPoint: lib.entryPoint,
      outFile: join(GENERATED_DIR, `memory-${lib.id}.js`),
    });
    const server = await startServer(bundlePath);
    const engine = await launchEngineWithProcess("webkit");
    runtime ||= `webkit ${engine.browser.version()} (${process.arch}-${process.platform})`;

    try {
      // Noise floor: the identical protocol with zero parses, on the first
      // fixture (its fetch is the representative "do nothing but load a
      // fixture" cost) — subtracted from every real fixture's delta below.
      const emptyRunDeltaBytes = await measureWebkitBatch(engine.browser, engine.pid, server.url, fixtures[0], 0);

      deltas[lib.id] = {};
      for (const fx of fixtures) {
        const raw = await measureWebkitBatch(engine.browser, engine.pid, server.url, fx, ITERS);
        const net = raw - emptyRunDeltaBytes;
        deltas[lib.id][fx.name] = net;
        console.log(`  ${lib.id} / ${fx.name}: ΔVmHWM=${(net / 1024).toFixed(1)} KB (raw ${(raw / 1024).toFixed(1)} KB, noise floor ${(emptyRunDeltaBytes / 1024).toFixed(1)} KB)`);
      }
    } finally {
      await engine.close();
      await server.close();
    }
  }

  return { runtime, deltas };
}

// ---------------------------------------------------------------------------
// Shared: deltas -> ratio doc.
// ---------------------------------------------------------------------------

function ratioWorkloads(deltas: LibraryFixtureDeltas, fixtures: MemoryFixture[]): { workload: string; values: Record<string, number> }[] {
  const rows: { workload: string; values: Record<string, number> }[] = [];
  const selfDeltas = deltas["lightning-yaml"];
  if (!selfDeltas) throw new Error("lightning-yaml did not produce a measurement — cannot compute ratios against it");

  for (const fx of fixtures) {
    const selfDelta = selfDeltas[fx.name];
    if (!(selfDelta > 0)) {
      console.warn(`  ! skipping ${fx.name}: lightning-yaml's own net delta was non-positive (${selfDelta} B, noise-dominated) — no meaningful ratio`);
      continue;
    }
    const values: Record<string, number> = {};
    for (const [libId, byFixture] of Object.entries(deltas)) {
      const d = byFixture[fx.name];
      if (typeof d !== "number") continue;
      if (libId === "lightning-yaml") {
        values[libId] = 1; // by construction — see MemoryRatiosDocSchema's refine.
        continue;
      }
      if (!(d > 0)) {
        console.warn(`  ! ${libId}/${fx.name}: net delta non-positive (${d} B) — omitting its ratio for this workload`);
        continue;
      }
      values[libId] = +(d / selfDelta).toFixed(3);
    }
    rows.push({ workload: fx.name, values });
  }
  return rows;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || !isEngineName(arg)) {
    console.error("usage: node --import tsx bench/browser/memoryRun.ts <chromium|webkit>");
    process.exit(1);
  }
  const engine: EngineName = arg;

  await assertFixturesGenerated();
  mkdirSync(GENERATED_DIR, { recursive: true });

  const fixtures = memoryRatioFixtures();
  const libraries = memoryRatioLibraries();
  console.log(`Libraries: ${libraries.map((l) => l.id).join(", ")}`);
  console.log(`Fixtures: ${fixtures.map((f) => f.name).join(", ")} (K=${ITERS} retained parses each)`);
  for (const s of SKIPPED_FIXTURES) console.log(`  skipped: ${s.name} — ${s.reason}`);

  const { runtime, deltas } = engine === "chromium" ? await runChromiumLeg(libraries, fixtures) : await runWebkitLeg(libraries, fixtures);

  const workloads = ratioWorkloads(deltas, fixtures);
  if (workloads.length === 0) throw new Error("every workload was skipped — nothing to publish");

  const now = new Date();
  const doc = {
    suite: "memory-ratios" as const,
    scope: "competition",
    method: engine === "chromium" ? ("heap-delta" as const) : ("peak-rss" as const),
    unit: "ratio" as const,
    lower_is_better: true,
    schema_version: 1,
    generated: now.toISOString().slice(0, 10),
    generated_at: now.toISOString(),
    source: process.env.BENCH_SOURCE ?? gitShaOr("local"),
    env: { clk: "unknown", cpu: "unknown", runtime }, // no os access from inside the page — mirrors bench/browser/run.ts's speed doc.
    iterations: ITERS,
    libraries: libraries.map((l) => l.meta),
    workloads,
  };

  MemoryRatiosDocSchema.parse(doc); // fail fast if the emitted doc doesn't match its schema
  const outPath = outPathFor(engine);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toYaml(doc));
  console.log(`Wrote ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
