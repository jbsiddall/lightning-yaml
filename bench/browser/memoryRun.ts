/**
 * Browser parse-memory driver — publishes RATIOS ONLY, normalized to
 * lightning-yaml = 1.0, never absolute bytes (CLAUDE.md's benchmark-integrity
 * rule). One document per engine.
 *
 *   node --import tsx bench/browser/memoryRun.ts <chromium|webkit>
 *
 * Methodology, and why each part is there:
 *   - One bundle and one browser per library, so a measured page has never loaded a competitor's code.
 *   - chromium reads its own JS heap ("heap-delta"); webkit has no in-page memory API, so it reads
 *     the kernel's peak RSS for the process running page JS ("peak-rss") — weaker, and labelled so.
 *   - Two gc() passes with a settle gap per reading: one pass can leave the previous fixture's
 *     sweep work in flight and skew the next. Fixtures run smallest-first for the same reason.
 *   - K=60 retained parses: K=40 left the ~1 KB fixture inside the noise floor, and a larger K
 *     would push a 1 MB fixture's retained batch into the hundreds of MB.
 *   - The page reports how many retained results it dropped; short of K means it reloaded or
 *     crashed mid-batch, so the reading is thrown away.
 *
 * Env:
 *   BENCH_SOURCE      provenance string for the doc's `source` field (default: git sha)
 *   BENCH_MEM_ITERS   K, parses retained per fixture (default 60)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stringify as toYaml } from "yaml";
import type { Page } from "playwright-core";
import { candidates, candidateApplies, candidateSupports, libraryMeta } from "../candidates.ts";
import { datasetByName, fixtureExt, type Category } from "../fixtures/datasets.ts";
import { MemoryRatiosDocSchema } from "../schemas.ts";
import { buildBrowserBundle } from "./build.ts";
import { assertFixturesGenerated, startServer } from "./server.ts";
import { isEngineName, launchEngineWithProcess, type EngineName, type LaunchedEngineWithProcess } from "./engines.ts";
import { findUniqueDescendant, readVmHwmBytes, resetPeakRss, waitForRssStabilization } from "./memory/proc.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const GENERATED_DIR = join(ROOT, "bench", "browser", "generated");

const ITERS = Number(process.env.BENCH_MEM_ITERS) || 60;

// Smallest-first (see above). No JSON category — no YAML parser reads it — and no 10 MB
// xlarge fixture, which is over the browser fixture budget (bench/browser/manifest.ts).
const FIXTURE_NAMES = [
  "yaml-plain-small-records",
  "yaml-rich-small",
  "yaml-plain-medium-records",
  "yaml-rich-medium",
  "yaml-plain-large-records",
  "yaml-rich-large",
] as const;

interface MemoryFixture {
  name: string;
  category: Category;
  url: string;
}

const FIXTURES: MemoryFixture[] = FIXTURE_NAMES.map((name) => {
  const ds = datasetByName(name);
  return { name: ds.name, category: ds.category, url: `/fixtures/${ds.name}${fixtureExt(ds.category)}` };
});

// A new competitor in candidates.ts is picked up automatically, PROVIDED someone also writes
// its memory/entries/<name>.ts — an isolated bundle needs real import code, not derived code.
const LIBRARIES = candidates
  .filter((c) => candidateSupports(c, "parse") && FIXTURES.every((f) => candidateApplies(c, f.category, "parse")))
  .map((c) => ({ id: c.name, entryPoint: join(HERE, "memory", "entries", `${c.name}.ts`), meta: libraryMeta(c) }));

declare const window: {
  __memParseAndRetain?: (url: string, category: string, iters: number) => Promise<void>;
  __memDropRetained?: () => number;
  __memReadHeap?: () => Promise<number>;
};

interface Leg {
  method: "heap-delta" | "peak-rss";
  chromiumArgs: string[];
  /** Opens one library's page(s) and returns how to read them: bytes for one batch, plus the same protocol with nothing parsed. */
  open: (
    engine: LaunchedEngineWithProcess,
    serverUrl: string,
    probeFixture: MemoryFixture,
  ) => Promise<{ measure: (fx: MemoryFixture, iters: number) => Promise<number>; noiseFloor: () => Promise<number> }>;
}

async function parseAndRetain(page: Page, fx: MemoryFixture, iters: number): Promise<void> {
  await page.evaluate(
    ([url, category, n]) => window.__memParseAndRetain!(url as string, category as string, n as number),
    [fx.url, fx.category, iters],
  );
}

async function assertBatchSurvived(page: Page, iters: number): Promise<void> {
  const dropped = await page.evaluate(() => window.__memDropRetained!());
  if (dropped !== iters) {
    throw new Error(`only ${dropped}/${iters} retained results survived to the drop — page reloaded or crashed mid-batch, reading invalid`);
  }
}

const openChromiumPage: Leg["open"] = async (engine, serverUrl) => {
  const page = await engine.browser.newPage();
  page.on("pageerror", (err) => console.error(`  [page error] ${err}`));
  await page.goto(serverUrl, { waitUntil: "load" });
  const readHeap = (): Promise<number> => page.evaluate(() => window.__memReadHeap!());
  await readHeap(); // settle the post-load heap before it becomes anything's baseline

  return {
    measure: async (fx, iters) => {
      const before = await readHeap();
      await parseAndRetain(page, fx, iters);
      const after = await readHeap();
      await assertBatchSurvived(page, iters);
      return after - before;
    },
    // Two readings, nothing in between. Deliberately excludes the fixture fetch: on one
    // long-lived page that residue is warm-up noise that varies per library, so subtracting
    // it would bias the small fixtures by more than it removes.
    noiseFloor: async () => {
      const before = await readHeap();
      return (await readHeap()) - before;
    },
  };
};

// A fresh page per batch: resetting the peak counter only means anything on a process that
// hasn't already parsed something — which lets the noise floor be a real zero-parse run.
const openWebkitPages: Leg["open"] = (engine, serverUrl, probeFixture) => {
  const measure = async (fx: MemoryFixture, iters: number): Promise<number> => {
    const page = await engine.browser.newPage();
    try {
      await page.goto(serverUrl, { waitUntil: "load" });
      const webProcessPid = findUniqueDescendant(engine.pid, "WebKitWebProcess");
      await waitForRssStabilization(webProcessPid);
      resetPeakRss(webProcessPid);
      const baseline = readVmHwmBytes(webProcessPid);
      await parseAndRetain(page, fx, iters);
      const peak = readVmHwmBytes(webProcessPid);
      await assertBatchSurvived(page, iters);
      return peak - baseline;
    } finally {
      await page.close();
    }
  };
  return Promise.resolve({ measure, noiseFloor: () => measure(probeFixture, 0) });
};

const LEGS: Record<EngineName, Leg> = {
  chromium: {
    method: "heap-delta",
    chromiumArgs: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
    open: openChromiumPage,
  },
  webkit: { method: "peak-rss", chromiumArgs: [], open: openWebkitPages },
};

interface LibraryFixtureDeltas {
  [libraryId: string]: { [fixtureName: string]: number };
}

async function runLeg(engineName: EngineName, leg: Leg): Promise<{ runtime: string; deltas: LibraryFixtureDeltas }> {
  const deltas: LibraryFixtureDeltas = {};
  let runtime = "";

  for (const lib of LIBRARIES) {
    console.log(`[${engineName}] ${lib.id}: building isolated bundle…`);
    const { bundlePath } = await buildBrowserBundle({
      entryPoint: lib.entryPoint,
      outFile: join(GENERATED_DIR, `memory-${lib.id}.js`),
    });
    const server = await startServer(bundlePath);
    const engine = await launchEngineWithProcess(engineName, leg.chromiumArgs);
    runtime ||= `${engineName} ${engine.browser.version()} (${process.arch}-${process.platform})`;

    try {
      const { measure, noiseFloor } = await leg.open(engine, server.url, FIXTURES[0]);
      const noise = await noiseFloor();

      deltas[lib.id] = {};
      for (const fx of FIXTURES) {
        const raw = await measure(fx, ITERS);
        const net = raw - noise;
        deltas[lib.id][fx.name] = net;
        console.log(`  ${lib.id} / ${fx.name}: ${(net / 1024).toFixed(1)} KB (raw ${(raw / 1024).toFixed(1)} KB, noise floor ${(noise / 1024).toFixed(1)} KB)`);
      }
    } finally {
      await engine.close();
      await server.close();
    }
  }

  return { runtime, deltas };
}

function ratioWorkloads(deltas: LibraryFixtureDeltas): { workload: string; values: Record<string, number> }[] {
  const rows: { workload: string; values: Record<string, number> }[] = [];
  const selfDeltas = deltas["lightning-yaml"];
  if (!selfDeltas) throw new Error("lightning-yaml did not produce a measurement — cannot compute ratios against it");

  for (const fx of FIXTURES) {
    const selfDelta = selfDeltas[fx.name];
    // A non-positive delta is noise — a ratio built on one would invent a number, not report one.
    if (!(selfDelta > 0)) {
      console.warn(`  ! skipping ${fx.name}: lightning-yaml's own net delta was non-positive (${selfDelta} B, noise-dominated) — no meaningful ratio`);
      continue;
    }
    const values: Record<string, number> = {};
    for (const [libId, byFixture] of Object.entries(deltas)) {
      const d = byFixture[fx.name];
      if (typeof d !== "number") continue;
      if (libId === "lightning-yaml") {
        values[libId] = 1;
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

function gitShaOr(fallback: string): string {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  return sha || fallback;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || !isEngineName(arg)) {
    console.error("usage: node --import tsx bench/browser/memoryRun.ts <chromium|webkit>");
    process.exit(1);
  }
  const engineName: EngineName = arg;

  await assertFixturesGenerated();
  mkdirSync(GENERATED_DIR, { recursive: true });

  console.log(`Libraries: ${LIBRARIES.map((l) => l.id).join(", ")}`);
  console.log(`Fixtures: ${FIXTURES.map((f) => f.name).join(", ")} (K=${ITERS} retained parses each)`);

  const leg = LEGS[engineName];
  const { runtime, deltas } = await runLeg(engineName, leg);

  const workloads = ratioWorkloads(deltas);
  if (workloads.length === 0) throw new Error("every workload was skipped — nothing to publish");

  const now = new Date();
  const doc = {
    suite: "memory-ratios" as const,
    scope: "competition",
    method: leg.method,
    unit: "ratio" as const,
    lower_is_better: true,
    schema_version: 1,
    generated: now.toISOString().slice(0, 10),
    generated_at: now.toISOString(),
    source: process.env.BENCH_SOURCE ?? gitShaOr("local"),
    env: { clk: "unknown", cpu: "unknown", runtime }, // a page can't read the host's hardware — same as bench/browser/run.ts
    iterations: ITERS,
    libraries: LIBRARIES.map((l) => l.meta),
    workloads,
  };

  MemoryRatiosDocSchema.parse(doc); // fail fast if the emitted doc doesn't match its schema
  const outPath = join(ROOT, "results", "benchmarks", `memory-ratios-${engineName}.yaml`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toYaml(doc));
  console.log(`Wrote ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
