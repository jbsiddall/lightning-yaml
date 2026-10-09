/**
 * Browser parse-memory driver — publishes RATIOS ONLY, normalized to
 * lightning-yaml = 1.0, never absolute bytes (CLAUDE.md's benchmark-integrity
 * rule). One document per engine.
 *
 *   node --import tsx bench/browser/memoryRun.ts <chromium|webkit>
 *
 * Methodology, and why each part is there:
 *   - One bundle and one browser per library, so a measured page has never loaded a competitor's code.
 *   - chromium reads its own JS heap ("heap-delta") — how much the retained results still hold,
 *     narrower; webkit has no in-page memory API, so it reads the kernel's peak RSS for the process
 *     running page JS ("peak-rss") — broader and noisier. Two questions, not one metric.
 *   - An untimed warm-up batch per page before anything is measured: a library pays one-time costs
 *     (schema tables, compiled regexes, JIT tier-up, feedback vectors) on its first parses, and
 *     measured they land entirely on fixture #1 — which inflated the smallest workload's ratio 2-5×.
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
import type { MemoryPageHooks } from "./memory/hooks.ts";
import { peakRssGrowthDuring } from "./memory/proc.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const GENERATED_DIR = join(ROOT, "bench", "browser", "generated");

// Validated here, not trusted: a fractional or negative K reaches the page as `new Array(K)` and
// surfaces as an opaque page-evaluate rejection instead of a usage error.
const REQUESTED_ITERS = Number(process.env.BENCH_MEM_ITERS);
const ITERS = Number.isInteger(REQUESTED_ITERS) && REQUESTED_ITERS > 0 ? REQUESTED_ITERS : 60;
if (process.env.BENCH_MEM_ITERS && REQUESTED_ITERS !== ITERS) {
  console.warn(`BENCH_MEM_ITERS="${process.env.BENCH_MEM_ITERS}" is not a positive integer — using K=${ITERS}`);
}

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
  bytes: number;
  url: string;
}

const FIXTURES: MemoryFixture[] = FIXTURE_NAMES.map((name) => {
  const ds = datasetByName(name);
  return { name: ds.name, category: ds.category, bytes: ds.bytes, url: `/fixtures/${ds.name}${fixtureExt(ds.category)}` };
});

// A new competitor in candidates.ts is picked up automatically, PROVIDED someone also writes
// its memory/entries/<name>.ts — an isolated bundle needs real import code, not derived code.
const LIBRARIES = candidates
  .filter((c) => candidateSupports(c, "parse") && FIXTURES.every((f) => candidateApplies(c, f.category, "parse")))
  .map((c) => ({ id: c.name, entryPoint: join(HERE, "memory", "entries", `${c.name}.ts`), meta: libraryMeta(c) }));

declare const window: MemoryPageHooks;

// Under 100 KB a peak-RSS reading is dominated by the library's fixed footprint rather than the parse (measured: `yaml`'s peak on the ~1 KB fixture is ~26 MB whether it parses it 60 times or 900), so the webkit leg publishes the bigger fixtures only.
const MEDIUM_AND_UP = FIXTURES.filter((f) => f.bytes >= 100_000);

interface Leg {
  method: "heap-delta" | "peak-rss";
  fixtures: MemoryFixture[];
  chromiumArgs?: string[];
  /** Opens one library's page(s) and returns how to read them: bytes for one batch, plus — where the leg has a meaningful one — the same protocol with nothing parsed. */
  open: (
    engine: LaunchedEngineWithProcess,
    serverUrl: string,
    probeFixture: MemoryFixture,
  ) => Promise<{ measure: (fx: MemoryFixture, iters: number) => Promise<number>; noiseFloor?: () => Promise<number> }>;
}

async function parseAndRetain(page: Page, fx: MemoryFixture, iters: number): Promise<void> {
  await page.evaluate(
    ([url, category, n]) => window.__memParseAndRetain!(url as string, category as string, n as number),
    [fx.url, fx.category, iters],
  );
}

async function assertBatchSurvived(page: Page, iters: number): Promise<void> {
  // The harness check rides along in the same round-trip because the count alone is vacuous at
  // iters=0 (the webkit floor): a page that reloaded and lost its batch also reports 0.
  const state = await page.evaluate(() => ({
    installed: typeof window.__memParseAndRetain === "function",
    dropped: window.__memDropRetained?.() ?? -1,
  }));
  if (!state.installed || state.dropped !== iters) {
    throw new Error(
      `batch integrity check failed (harness ${state.installed ? "installed" : "MISSING"}, ${state.dropped}/${iters} retained results survived to the drop) — page reloaded or crashed mid-batch, reading invalid`,
    );
  }
}

/**
 * A full untimed batch, thrown away — see the warm-up note in this file's header. It has to be K
 * parses, not one: measured on chromium, a single warm-up parse still left fixture #1 reading
 * ~2.5× its steady state, because the cost is not only first-parse init but the JIT tier-up and
 * feedback vectors a hot loop accumulates over the whole batch.
 */
async function warmUp(page: Page, probeFixture: MemoryFixture): Promise<void> {
  await parseAndRetain(page, probeFixture, ITERS);
  await assertBatchSurvived(page, ITERS);
}

const openChromiumPage: Leg["open"] = async (engine, serverUrl, probeFixture) => {
  const page = await engine.browser.newPage();
  page.on("pageerror", (err) => console.error(`  [page error] ${err}`));
  await page.goto(serverUrl, { waitUntil: "load" });
  const readHeap = (): Promise<number> => page.evaluate(() => window.__memReadHeap!());
  await warmUp(page, probeFixture);
  await readHeap(); // collects the warm-up and settles the post-load heap before it becomes anything's baseline

  // No noise floor: two gc'd reads with nothing in between are equal by construction, so
  // subtracting them corrects for nothing. A real zero-parse floor is wrong here too — measured on
  // this long-lived page it captures per-library page warm-up (16-32 KB, differing per library),
  // so subtracting it would bias the small fixtures rather than clean them.
  return {
    measure: async (fx, iters) => {
      const before = await readHeap();
      await parseAndRetain(page, fx, iters);
      const after = await readHeap();
      await assertBatchSurvived(page, iters);
      return after - before;
    },
  };
};

// Playwright ships both WebKit ports and launches WPE on Linux (WPEWebProcess) vs GTK elsewhere (WebKitWebProcess); neither name matches the sibling *NetworkProcess, which must not be measured.
const WEBKIT_PAGE_PROCESSES = ["WPEWebProcess", "WebKitWebProcess"];

// A fresh page per batch, so every fixture's peak is read off counters reset on a process that has done nothing but the warm-up — which is also what lets the noise floor be a real zero-parse run, and why the warm-up uses the SMALLEST fixture (webkit has no gc() to force, so its uncollected batch must stay negligible against the measured one).
const openWebkitPages: Leg["open"] = (engine, serverUrl, probeFixture) => {
  const measure = async (fx: MemoryFixture, iters: number): Promise<number> => {
    const page = await engine.browser.newPage();
    try {
      await page.goto(serverUrl, { waitUntil: "load" });
      await warmUp(page, probeFixture); // before the reset, so init memory sits under the baseline rather than in the peak
      const growth = await peakRssGrowthDuring(engine.pid, WEBKIT_PAGE_PROCESSES, () => parseAndRetain(page, fx, iters));
      await assertBatchSurvived(page, iters);
      return growth;
    } finally {
      await page.close();
    }
  };
  return Promise.resolve({ measure, noiseFloor: () => measure(probeFixture, 0) });
};

const LEGS: Record<EngineName, Leg> = {
  chromium: {
    method: "heap-delta",
    fixtures: FIXTURES, // its gc'd retained-heap read stays clean at 1 KB, so it keeps the small fixtures
    chromiumArgs: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
    open: openChromiumPage,
  },
  webkit: { method: "peak-rss", fixtures: MEDIUM_AND_UP, open: openWebkitPages },
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
      const noise = noiseFloor ? await noiseFloor() : 0;
      const floorNote = noiseFloor ? `, noise floor ${(noise / 1024).toFixed(1)} KB` : "";

      deltas[lib.id] = {};
      for (const fx of leg.fixtures) {
        const raw = await measure(fx, ITERS);
        const net = raw - noise;
        deltas[lib.id][fx.name] = net;
        console.log(`  ${lib.id} / ${fx.name}: ${(net / 1024).toFixed(1)} KB (raw ${(raw / 1024).toFixed(1)} KB${floorNote})`);
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
      // Re-guard AFTER rounding: a ratio under 0.0005 becomes 0.000, which the schema's
      // `.positive()` then rejects — losing the whole run instead of one library's cell.
      const ratio = +(d / selfDelta).toFixed(3);
      if (ratio <= 0) {
        console.warn(`  ! ${libId}/${fx.name}: ratio ${d}/${selfDelta} rounds to ${ratio} — below what 3 decimal places can express, omitting it`);
        continue;
      }
      values[libId] = ratio;
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

  const leg = LEGS[engineName];
  const skipped = FIXTURES.filter((f) => !leg.fixtures.includes(f));

  console.log(`Libraries: ${LIBRARIES.map((l) => l.id).join(", ")}`);
  console.log(`Fixtures: ${leg.fixtures.map((f) => f.name).join(", ")} (K=${ITERS} retained parses each)`);
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.map((f) => f.name).join(", ")}: too small for ${leg.method} — the reading would be the library's fixed footprint, not the parse`);
  }

  const { runtime, deltas } = await runLeg(engineName, leg);

  const workloads = ratioWorkloads(deltas, leg.fixtures);
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
