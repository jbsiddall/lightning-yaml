// src/lib/queries.ts
//
// All the interaction with the benchmark YAML data lives here — read the raw
// append-only multi-document streams (src/data/benchmarks/*.yaml), validate
// them against bench/schemas.ts (the single source of truth for the doc
// shape — also used by bench/validate.ts and the emitters), and select/shape
// the validated docs for benchmarks.ts to render. A schema change there is a
// type error (and a build-time validation failure) here, not silent drift.
// No chart or table rendering happens here; that's benchmarks.ts, which
// imports from this file. Everything runs at Astro BUILD TIME — no browser
// APIs, no client JS.

// Dogfood: the docs site parses its own benchmark data with lightning-yaml.
import { parseAll } from 'lightning-yaml';
import { z } from 'zod';
import {
  LIBRARY_IDS,
  LibraryMetaSchema,
  RuntimeEnvSchema,
  SpeedDocSchema,
  MemoryDocSchema,
  ConformanceDocSchema,
  BundleSizeDocSchema,
} from '../../../bench/schemas.ts';
// bundleSizeItems (below) shapes a doc into chart-ready items, which needs
// the brand color + versioned label — both presentation, so they stay
// defined in charts.ts; importing them back here is the one intentional
// exception to this file's "queries only, no rendering" rule.
import { LIBRARY_COLOR, libraryLabel } from './charts';

export { SpeedDocSchema, MemoryDocSchema, ConformanceDocSchema, BundleSizeDocSchema };

// ---------------------------------------------------------------------------
// Doc types — every one inferred from bench/schemas.ts, not hand-declared, so
// a schema change there surfaces as a type error here instead of silently
// drifting. `LibraryId` is likewise derived from the schemas' own
// `LIBRARY_IDS` tuple (not widened to `string`), so indexing a `values` map
// by `LibraryId` stays exactly the literal union the schemas validate.
// ---------------------------------------------------------------------------

export type LibraryId = (typeof LIBRARY_IDS)[number];
export type LibraryMeta = z.infer<typeof LibraryMetaSchema>;

export type SpeedDoc = z.infer<typeof SpeedDocSchema>;
export type SpeedWorkload = SpeedDoc['operations']['parse'][number];
export type SpeedStat = NonNullable<SpeedWorkload['values'][LibraryId]>;

export type MemoryDoc = z.infer<typeof MemoryDocSchema>;
export type MemoryWorkload = MemoryDoc['operations']['parse'][number];
export type MemoryStat = NonNullable<MemoryWorkload['values'][LibraryId]>;

export type ConformanceDoc = z.infer<typeof ConformanceDocSchema>;
export type ConformanceResult = ConformanceDoc['results'][number];

export type BundleSizeDoc = z.infer<typeof BundleSizeDocSchema>;
export type BundleSizeResult = BundleSizeDoc['results'][number];
export type BundleSizeValue = NonNullable<BundleSizeResult['values'][LibraryId]>;

/** One row of a bar chart (or its table twin) — site-only, no schema counterpart. */
export interface BarItem {
  id: string;
  label: string;
  value: number;
  color: string;
  self?: boolean;
  sublabel?: string;
}

// ---------------------------------------------------------------------------
// Loaders — every *.yaml data file is an append-only multi-document stream;
// CI appends a new '---' document per run and never rewrites earlier ones.
// `parseRuns` validates every document against `schema` (throws on the first
// invalid one) — cheap at today's stream sizes, so callers that need the
// full run history (trend charts) and callers that only need the newest
// document both go through the same validated array; nothing here re-parses
// or re-validates a stream it's already loaded.
// ---------------------------------------------------------------------------

export function parseRuns<S extends z.ZodType>(raw: string, schema: S): z.infer<S>[] {
  return (parseAll(raw) as unknown[]).map((doc) => schema.parse(doc));
}

/** The last element of an already-loaded run history. Throws if empty. */
export function newestOf<T>(runs: readonly T[]): T {
  const last = runs.at(-1);
  if (!last) throw new Error('benchmark YAML stream has no documents');
  return last;
}

/** parseRuns + newestOf, for a caller that only wants the newest document, not the full history. */
export function newestRun<S extends z.ZodType>(raw: string, schema: S): z.infer<S> {
  return newestOf(parseRuns(raw, schema));
}

// ---------------------------------------------------------------------------
// Runtime dimension — CI will publish `speed.yaml` runs from more than one
// execution environment (node, chromium, webkit, bun), distinguished by each
// document's `env.runtime` string (e.g. "node 24.18.0 (x64-linux)"). Only the
// speed suite records `env.runtime` today; memory, conformance, and
// bundle-size stay single-environment (see each doc's schema above), so
// `newestOf` remains the right loader for those. These helpers all take an
// already-loaded run array (from `parseRuns`), not a raw string, so a caller
// juggling both a run history and a family selection never parses twice.
// ---------------------------------------------------------------------------

type WithRuntime = { env: z.infer<typeof RuntimeEnvSchema> };

/** The runtime family from an `env.runtime` string, e.g. "node 24.18.0 (x64-linux)" -> "node". */
export function runtimeFamily(runtime: string): string {
  return runtime.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

export interface RuntimeRun<T> {
  family: string;
  /** Full `env.runtime` string of this family's newest run — the picker's display label. */
  runtime: string;
  doc: T;
}

export function availableRuntimes<T extends WithRuntime>(runs: readonly T[]): RuntimeRun<T>[] {
  const byFamily = new Map<string, T>();
  // Append order -> later assignments overwrite earlier ones, so each family ends up on its newest doc.
  for (const doc of runs) byFamily.set(runtimeFamily(doc.env.runtime), doc);
  return [...byFamily].map(([family, doc]) => ({ family, runtime: doc.env.runtime, doc }));
}

/** The newest document for one runtime family. Throws if `runs` has no run from that family. */
export function newestRunFor<T extends WithRuntime>(runs: readonly T[], family: string): T {
  const match = availableRuntimes(runs).find((r) => r.family === family);
  if (!match) throw new Error(`benchmark YAML stream has no "${family}" runtime run`);
  return match.doc;
}

export function runsForFamily<T extends WithRuntime>(runs: readonly T[], family: string): T[] {
  return runs.filter((r) => runtimeFamily(r.env.runtime) === family);
}

/**
 * Preference order for the runtime headline claims (hero panel, landing lead
 * paragraph) are derived from: Chromium first — the browser is this
 * library's primary target — falling back to Node while no chromium
 * documents exist yet. So today `canonicalFamily` always resolves to "node",
 * and the moment CI publishes a chromium run every headline switches to it
 * automatically, no code change required. Every non-canonical family stays
 * selectable context on /benchmarks, never the headline.
 */
export const CANONICAL_RUNTIMES = ['chromium', 'node'] as const;

export function canonicalFamily<T extends WithRuntime>(runs: readonly T[]): string {
  const present = new Set(availableRuntimes(runs).map((r) => r.family));
  return CANONICAL_RUNTIMES.find((f) => present.has(f)) ?? CANONICAL_RUNTIMES.at(-1)!;
}

export function canonicalRun<T extends WithRuntime>(runs: readonly T[]): T {
  return newestRunFor(runs, canonicalFamily(runs));
}

// ---------------------------------------------------------------------------
// Ratio queries — a same-run ratio (e.g. js-yaml.avg / lightning-yaml.avg for
// one workload) is a same-machine, same-run comparison, so this repo NEVER
// blends one across environments into a single number — a browser engine and
// Node are different machines with different results, and combining them
// would hide that. Every ratio shown anywhere on the site is one real
// measurement in one named environment (see `canonicalSpeedRatio` /
// `canonicalMemoryRatio`, which read straight off `canonicalRun`). What this
// section DOES provide is the per-environment ratio COLLECTION — every
// family's own ratio, unblended — for two honest uses: a popover breakdown
// listing each engine's own number, and a data-derived "up to N×" range
// across the environments that have actually published. Scoped to one
// workload — sizes are never combined together. A family contributes only
// when BOTH libraries in the pair have a value in its newest document (e.g.
// JSON.parse never ran on a block-YAML workload, so it silently drops out of
// that ratio rather than producing a bogus one).
// ---------------------------------------------------------------------------

/** One environment's own measured ratio — never combined with any other environment's. */
export interface RatioPoint {
  family: string;
  /** Full `env.runtime` string of this family's newest run (e.g. "node 24.18.0 (x64-linux)"). */
  runtime: string;
  ratio: number;
}

/** Shared plumbing: one ratio per family's newest doc, for the families where both libraries in the pair have a value. */
function ratioAcrossFamilies<T extends WithRuntime>(
  runs: readonly T[],
  ratioOf: (doc: T) => number | undefined,
): RatioPoint[] {
  const points: RatioPoint[] = [];
  for (const { family, runtime, doc } of availableRuntimes(runs)) {
    const r = ratioOf(doc);
    if (typeof r === 'number' && Number.isFinite(r) && r > 0) points.push({ family, runtime, ratio: r });
  }
  return points;
}

function speedRatioIn(doc: SpeedDoc, op: 'parse' | 'stringify', workload: string, numerator: LibraryId, denominator: LibraryId): number | undefined {
  const w = doc.operations[op].find((x) => x.workload === workload);
  const num = w?.values[numerator]?.avg;
  const den = w?.values[denominator]?.avg;
  return typeof num === 'number' && typeof den === 'number' && den > 0 ? num / den : undefined;
}

function memoryRatioIn(doc: MemoryDoc, op: 'parse' | 'stringify', workload: string, numerator: LibraryId, denominator: LibraryId): number | undefined {
  const w = doc.operations[op].find((x) => x.workload === workload);
  const num = w?.values[numerator]?.peak_rss;
  const den = w?.values[denominator]?.peak_rss;
  return typeof num === 'number' && typeof den === 'number' && den > 0 ? num / den : undefined;
}

/** Every runtime family's own `numerator.avg / denominator.avg` for one workload — unblended, one entry per environment. */
export function speedWorkloadRatio(
  runs: readonly SpeedDoc[],
  op: 'parse' | 'stringify',
  workload: string,
  numerator: LibraryId,
  denominator: LibraryId,
): RatioPoint[] {
  return ratioAcrossFamilies(runs, (doc) => speedRatioIn(doc, op, workload, numerator, denominator));
}

/** Every runtime family's own `numerator.peak_rss / denominator.peak_rss` for one workload — unblended, one entry per environment. */
export function memoryWorkloadRatio(
  runs: readonly MemoryDoc[],
  op: 'parse' | 'stringify',
  workload: string,
  numerator: LibraryId,
  denominator: LibraryId,
): RatioPoint[] {
  return ratioAcrossFamilies(runs, (doc) => memoryRatioIn(doc, op, workload, numerator, denominator));
}

/**
 * THE headline number: the canonical environment's own measured ratio for one
 * workload — a single real measurement, never averaged or blended with any
 * other environment. `undefined` when the canonical run doesn't have a value
 * for one side of the pair (that workload/library combination simply isn't
 * shown, rather than silently falling back to a different environment).
 */
export function canonicalSpeedRatio(
  runs: readonly SpeedDoc[],
  op: 'parse' | 'stringify',
  workload: string,
  numerator: LibraryId,
  denominator: LibraryId,
): number | undefined {
  return speedRatioIn(canonicalRun(runs), op, workload, numerator, denominator);
}

/** THE headline number for memory: see `canonicalSpeedRatio` — same contract, `peak_rss` instead of `avg`. */
export function canonicalMemoryRatio(
  runs: readonly MemoryDoc[],
  op: 'parse' | 'stringify',
  workload: string,
  numerator: LibraryId,
  denominator: LibraryId,
): number | undefined {
  return memoryRatioIn(canonicalRun(runs), op, workload, numerator, denominator);
}

// ---------------------------------------------------------------------------
// Data-shaping helpers — select/order the validated docs into the shapes the
// chart and table builders in charts.ts consume.
// ---------------------------------------------------------------------------

/** Select + order a curated subset of workloads by name; silently skips any that aren't found. */
export function pickWorkloads<T extends { workload: string }>(workloads: T[], names: readonly string[]): T[] {
  return names.flatMap((name) => {
    const w = workloads.find((x) => x.workload === name);
    return w ? [w] : [];
  });
}

/**
 * Canonical series order, used consistently across every chart on the page.
 * A chart shows only the subset actually present in its workloads (see
 * `presentIn` in benchmarks.ts) — so `js-yaml-tuned`, which has stringify
 * data only, never appears as an empty series on the parse or memory charts.
 */
export const LIBRARY_ORDER: readonly LibraryId[] = [
  'JSON',
  'lightning-yaml',
  'js-yaml',
  'js-yaml-tuned',
  'yaml',
];

/**
 * BundleSizeDoc -> BarItem[], one item per library, sorted best-first
 * (lower_is_better). `value` is the MINIMUM gzip size across every bundler
 * that measured that library — the best achievable result, since bundler
 * choice is a build-tool decision, not something the library controls.
 * Errored (bundler, library) pairs are simply excluded from that minimum.
 */
export function bundleSizeItems(doc: BundleSizeDoc): BarItem[] {
  const ids = LIBRARY_ORDER.filter((id) => doc.libraries.some((l) => l.id === id));
  return ids
    .map((id) => {
      const gzips = doc.results
        .map((r) => r.values[id])
        .filter((v): v is BundleSizeValue => Boolean(v) && typeof v!.gzip === 'number');
      const value = gzips.length ? Math.min(...gzips.map((v) => v.gzip as number)) : 0;
      return {
        id,
        label: libraryLabel(doc.libraries, id),
        value,
        color: LIBRARY_COLOR[id],
        self: id === 'lightning-yaml',
      };
    })
    .sort((a, b) => a.value - b.value);
}
