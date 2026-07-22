// src/lib/queries.ts
//
// All the interaction with the benchmark YAML data lives here — read the raw
// append-only multi-document streams (src/data/benchmarks/*.yaml) and
// select/shape them into the doc types below. No chart or table rendering
// happens here; that's benchmarks.ts, which imports from this file.
// Everything runs at Astro BUILD TIME — no browser APIs, no client JS. See
// CLAUDE.md ("Benchmarking rules") and the header comment of each YAML file
// for the source schema this mirrors.

// Dogfood: the docs site parses its own benchmark data with lightning-yaml.
import { parseAll } from 'lightning-yaml';
// bundleSizeItems (below) shapes a doc into chart-ready items, which needs
// the brand color + versioned label — both presentation, so they stay
// defined in benchmarks.ts; importing them back here is the one intentional
// exception to this file's "queries only, no rendering" rule.
import { LIBRARY_COLOR, libraryLabel } from './benchmarks';

// ---------------------------------------------------------------------------
// Schema types (mirror the header comments in src/data/benchmarks/*.yaml)
// ---------------------------------------------------------------------------

export type LibraryId = 'JSON' | 'js-yaml' | 'js-yaml-tuned' | 'yaml' | 'lightning-yaml';

export interface LibraryMeta {
  id: LibraryId;
  label: string;
  baseline?: boolean;
  self?: boolean;
  version?: string;
}

export interface SpeedStat {
  avg: number;
  min: number;
  p75: number;
  p99: number;
  max: number;
}

export interface SpeedWorkload {
  workload: string;
  values: Partial<Record<LibraryId, SpeedStat>>;
}

export interface SpeedDoc {
  suite: 'speed';
  scope: string;
  tool: string;
  unit: string;
  lower_is_better: boolean;
  generated: string;
  source: string;
  env: { clk: string; cpu: string; runtime: string };
  libraries: LibraryMeta[];
  operations: { parse: SpeedWorkload[]; stringify: SpeedWorkload[] };
}

export interface MemoryStat {
  peak_rss: number;
  heap_delta: number;
}

export interface MemoryWorkload {
  workload: string;
  values: Partial<Record<LibraryId, MemoryStat>>;
}

export interface MemoryDoc {
  suite: 'memory';
  scope: string;
  env: { clk: string; cpu: string; runtime: string };
  units: { peak_rss: string; heap_delta: string };
  lower_is_better: boolean;
  iterations: number;
  generated: string;
  source: string;
  libraries: LibraryMeta[];
  operations: { parse: MemoryWorkload[]; stringify: MemoryWorkload[] };
}

export interface ConformanceResult {
  id: LibraryId;
  label: string;
  passed: number;
  total: number;
  score: number;
  self?: boolean;
  version?: string;
  // Present on the self row (the should-fail subset); the conformance page reads it.
  negative_passed?: number;
  negative_total?: number;
}

export interface ConformanceDoc {
  suite: 'conformance';
  suite_total: number;
  unit: string;
  higher_is_better: boolean;
  generated: string;
  source: string;
  results: ConformanceResult[];
}

export interface BundleSizeValue {
  min?: number;
  gzip?: number;
  brotli?: number;
  error?: string;
}

export interface BundleSizeResult {
  bundler: string;
  rust: boolean;
  values: Partial<Record<LibraryId, BundleSizeValue>>;
}

export interface BundleSizeDoc {
  suite: 'bundle-size';
  scope: string;
  tool: string;
  units: { min: string; gzip: string; brotli: string };
  lower_is_better: boolean;
  generated: string;
  source: string;
  env: { bundlers: Record<string, string> };
  libraries: LibraryMeta[];
  results: BundleSizeResult[];
}

/** One row of a bar chart (or its table twin): a library's value plus enough to render it standalone. */
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
// The site always renders the newest (last) document.
// ---------------------------------------------------------------------------

/** Parse every `---` document in an append-only benchmark YAML stream. */
export function parseRuns<T>(raw: string): T[] {
  return parseAll(raw) as T[];
}

/** The newest (last-appended) run of a benchmark suite. */
export function newestRun<T>(raw: string): T {
  const runs = parseRuns<T>(raw);
  const last = runs.at(-1);
  if (!last) throw new Error('benchmark YAML stream has no documents');
  return last;
}

// ---------------------------------------------------------------------------
// Runtime dimension — CI will publish `speed.yaml` runs from more than one
// execution environment (node, chromium, webkit, bun), distinguished by each
// document's `env.runtime` string (e.g. "node 24.18.0 (x64-linux)"). Only the
// speed suite records `env.runtime` today; memory, conformance, and
// bundle-size stay single-environment (see each doc's schema above), so
// `newestRun` remains the right loader for those.
// ---------------------------------------------------------------------------

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

/** Every runtime family present in an append-only stream, each mapped to its own newest document. */
export function availableRuntimes<T extends { env: { runtime: string } }>(raw: string): RuntimeRun<T>[] {
  const byFamily = new Map<string, T>();
  // Append order -> later assignments overwrite earlier ones, so each family ends up on its newest doc.
  for (const doc of parseRuns<T>(raw)) byFamily.set(runtimeFamily(doc.env.runtime), doc);
  return [...byFamily].map(([family, doc]) => ({ family, runtime: doc.env.runtime, doc }));
}

/** The newest document for one runtime family. Throws if the stream has no run from that family. */
export function newestRunFor<T extends { env: { runtime: string } }>(raw: string, family: string): T {
  const match = availableRuntimes<T>(raw).find((r) => r.family === family);
  if (!match) throw new Error(`benchmark YAML stream has no "${family}" runtime run`);
  return match.doc;
}

/** Narrow a run history to one runtime family, preserving chronological (append) order. */
export function runsForFamily<T extends { env: { runtime: string } }>(runs: readonly T[], family: string): T[] {
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

/** The first family of CANONICAL_RUNTIMES actually present in the stream. */
export function canonicalFamily(raw: string): string {
  const present = new Set(availableRuntimes<{ env: { runtime: string } }>(raw).map((r) => r.family));
  return CANONICAL_RUNTIMES.find((f) => present.has(f)) ?? CANONICAL_RUNTIMES.at(-1)!;
}

/** The newest document of the canonical runtime family (see `canonicalFamily`). */
export function canonicalRun<T extends { env: { runtime: string } }>(raw: string): T {
  return newestRunFor<T>(raw, canonicalFamily(raw));
}

// ---------------------------------------------------------------------------
// Data-shaping helpers — select/order the parsed docs into the shapes the
// chart and table builders in benchmarks.ts consume.
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
