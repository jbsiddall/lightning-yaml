/**
 * Browser parse-memory driver — publishes RATIOS ONLY, normalized to
 * lightning-yaml = 1.0, never absolute bytes (CLAUDE.md's benchmark-integrity
 * rule). One document per engine.
 *
 *   node --import tsx bench/browser/memoryRun.ts <chromium|webkit>
 *
 * Methodology, and why each part is there:
 *   - Every library gets its own bundle and its own browser, so the page being
 *     measured has never loaded a competing library's code.
 *   - chromium reads its own JS heap ("heap-delta"); webkit exposes no in-page
 *     memory API, so it reads the kernel's peak RSS for the process running
 *     page JS instead ("peak-rss") — a weaker signal, labelled as such wherever
 *     it's shown.
 *   - Readings are taken after two gc() passes with a settle gap: one pass can
 *     leave the previous fixture's sweep work in flight and skew the next one.
 *   - Fixtures run smallest-first, for the same reason.
 *   - K=60 retained parses per fixture: K=40 left the ~1 KB fixture inside the
 *     noise floor, and a bigger K would push a 1 MB fixture's retained batch
 *     past the hundreds of MB.
 *   - The page reports how many retained results it dropped. A count short of K
 *     means it reloaded or crashed mid-batch, so the reading is thrown away.
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
import { candidates, candidateApplies, candidateSupports, libraryMeta, type LibraryMeta } from "../candidates.ts";
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

// Smallest-first (see the methodology note above). No `json` category and no
// 10 MB xlarge fixture: no YAML parser reads the former, and the latter is over
// the browser fixture budget (bench/browser/manifest.ts) either way.
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

interface MemoryLibrary {
  id: string;
  entryPoint: string;
  meta: LibraryMeta;
}

function memoryFixtures(): MemoryFixture[] {
  return FIXTURE_NAMES.map((name) => {
    const ds = datasetByName(name);
    return { name: ds.name, category: ds.category, url: `/fixtures/${ds.name}${fixtureExt(ds.category)}` };
  });
}

// A new competitor registered in candidates.ts is picked up here automatically,
// PROVIDED someone also adds its memory/entries/<name>.ts — an isolated
// single-library bundle needs real import code, which can't be derived.
function memoryLibraries(fixtures: MemoryFixture[]): MemoryLibrary[] {
  return candidates
    .filter((c) => candidateSupports(c, "parse") && fixtures.every((f) => candidateApplies(c, f.category, "parse")))
    .map((c) => ({ id: c.name, entryPoint: join(HERE, "memory", "entries", `${c.name}.ts`), meta: libraryMeta(c) }));
}

declare const window: {
  __memParseAndRetain?: (url: string, category: string, iters: number) => Promise<void>;
  __memDropRetained?: () => number;
  __memReadHeap?: () => Promise<number>;
};

interface LegRunner {
  /** Bytes attributable to one (fixture, iters) batch. */
  measure: (fx: MemoryFixture, iters: number) => Promise<number>;
  /** The same reading protocol with nothing parsed — subtracted from every fixture below. */
  noiseFloor: () => Promise<number>;
}

type Measurer = (engine: LaunchedEngineWithProcess, serverUrl: string, probeFixture: MemoryFixture) => Promise<LegRunner>;

interface Leg {
  method: "heap-delta" | "peak-rss";
  chromiumArgs: string[];
  measurer: Measurer;
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

const chromiumMeasurer: Measurer = async (engine, serverUrl) => {
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
    // Two readings with nothing at all in between. Fetching a fixture is
    // deliberately NOT part of this: on one long-lived page its residue is
    // per-library page warm-up, not a per-batch cost, so subtracting it would
    // bias the small fixtures by more than it removes.
    noiseFloor: async () => {
      const before = await readHeap();
      return (await readHeap()) - before;
    },
  };
};

// A fresh page per batch: clear_refs resets the peak counter, which only means
// anything on a process that hasn't already parsed something. Which also makes
// the noise floor a real run of the same protocol, with zero parses.
const webkitMeasurer: Measurer = (engine, serverUrl, probeFixture) => {
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
    measurer: chromiumMeasurer,
  },
  webkit: { method: "peak-rss", chromiumArgs: [], measurer: webkitMeasurer },
};

interface LibraryFixtureDeltas {
  [libraryId: string]: { [fixtureName: string]: number };
}

async function runLeg(
  engineName: EngineName,
  leg: Leg,
  libraries: MemoryLibrary[],
  fixtures: MemoryFixture[],
): Promise<{ runtime: string; deltas: LibraryFixtureDeltas }> {
  const deltas: LibraryFixtureDeltas = {};
  let runtime = "";

  for (const lib of libraries) {
    console.log(`[${engineName}] ${lib.id}: building isolated bundle…`);
    const { bundlePath } = await buildBrowserBundle({
      entryPoint: lib.entryPoint,
      outFile: join(GENERATED_DIR, `memory-${lib.id}.js`),
    });
    const server = await startServer(bundlePath);
    const engine = await launchEngineWithProcess(engineName, leg.chromiumArgs);
    runtime ||= `${engineName} ${engine.browser.version()} (${process.arch}-${process.platform})`;

    try {
      const { measure, noiseFloor } = await leg.measurer(engine, server.url, fixtures[0]);
      const noise = await noiseFloor();

      deltas[lib.id] = {};
      for (const fx of fixtures) {
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

function ratioWorkloads(deltas: LibraryFixtureDeltas, fixtures: MemoryFixture[]): { workload: string; values: Record<string, number> }[] {
  const rows: { workload: string; values: Record<string, number> }[] = [];
  const selfDeltas = deltas["lightning-yaml"];
  if (!selfDeltas) throw new Error("lightning-yaml did not produce a measurement — cannot compute ratios against it");

  for (const fx of fixtures) {
    const selfDelta = selfDeltas[fx.name];
    // A non-positive delta is noise, not a measurement — publishing a ratio
    // off one would invent a number rather than report one.
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

  const fixtures = memoryFixtures();
  const libraries = memoryLibraries(fixtures);
  console.log(`Libraries: ${libraries.map((l) => l.id).join(", ")}`);
  console.log(`Fixtures: ${fixtures.map((f) => f.name).join(", ")} (K=${ITERS} retained parses each)`);

  const leg = LEGS[engineName];
  const { runtime, deltas } = await runLeg(engineName, leg, libraries, fixtures);

  const workloads = ratioWorkloads(deltas, fixtures);
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
    libraries: libraries.map((l) => l.meta),
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
