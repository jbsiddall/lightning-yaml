// src/lib/charts.ts
//
// The presentation counterpart to `./queries` (which owns data: loading,
// validating, and shaping the benchmark YAML streams). Everything that turns
// that shaped data into on-page output — inline-SVG charts, HTML table
// strings, the ratio-bar builder, and the native-popover breakdown markup —
// lives here, so a chart bug gets fixed once regardless of which page uses
// it (HeroBench, /benchmarks' ChartCard, the Landing lead paragraph). Runs
// entirely at Astro BUILD TIME — no browser APIs, no client JS. See
// CLAUDE.md ("Benchmarking rules") and queries.ts for how the underlying
// YAML streams are loaded and shaped.

import { runtimeFamily, runsForFamily, pickWorkloads, LIBRARY_ORDER } from './queries';
import type {
  LibraryId,
  LibraryMeta,
  SpeedDoc,
  SpeedStat,
  SpeedWorkload,
  MemoryDoc,
  MemoryStat,
  MemoryWorkload,
  ConformanceDoc,
  ConformanceResult,
  BundleSizeDoc,
  BundleSizeValue,
  BarItem,
  RatioPoint,
} from './queries';

// ---------------------------------------------------------------------------
// Data-shaping helpers. These exist so the .mdx page — which compiles its
// component script as plain JS/JSX, not TypeScript — can stay a thin
// composition layer: pick workloads, shape them into chart input, done. All
// the typed logic (and the only place object shapes are assumed) lives here.
// ---------------------------------------------------------------------------

/** Append a version to a display label when the benchmark data recorded one (e.g. `js-yaml 5.2.1`). */
export function withVersion(label: string, version?: string): string {
  return version ? `${label} ${version}` : label;
}

/**
 * A section-scoped provenance line for /benchmarks — "Measured on <cpu>
 * (<clk>) · <runtime> · generated <date> · source <sha>" for a doc that
 * carries environment info (speed, memory, memory-ratios), or the leaner
 * "Generated <date> · source <sha>" for one that doesn't (conformance has no
 * `env` at all — it's a parser property, not a runtime measurement; bundle
 * size's `env` is bundler versions, not a CPU/runtime). Each section states
 * its OWN doc's provenance — a page-wide line reading one suite's data above
 * sections fed by other streams would misattribute them, the same shape #120
 * fixed for the hero's per-tab "Measured in" line.
 */
export function sourceLine(doc: { generated?: unknown; source?: unknown; env?: { cpu: string; clk: string; runtime: string } }): string {
  const generated = String(doc.generated ?? '');
  const source = String(doc.source ?? '');
  if (doc.env) {
    // Browser docs record cpu/clk as "unknown" — a page can't read the host's
    // hardware (see bench/browser/run.ts) — and printing that verbatim reads
    // like a bug, so name only what the doc actually knows.
    const where =
      doc.env.cpu === 'unknown' ? `in ${doc.env.runtime}` : `on ${doc.env.cpu} (${doc.env.clk}) · ${doc.env.runtime}`;
    return `Measured ${where} · generated ${generated} · source ${source}`;
  }
  return `Generated ${generated} · source ${source}`;
}

/** Look up a library's display label by id (with version when available), falling back to the id itself. */
export function libraryLabel(libraries: LibraryMeta[], id: LibraryId): string {
  const lib = libraries.find((l) => l.id === id);
  return withVersion(lib?.label ?? id, lib?.version);
}

/** Build a chart's `series` list (id + label + brand color) from a fixed id order. */
export function seriesFor(libraries: LibraryMeta[], ids: readonly LibraryId[]): GroupedSeries[] {
  return ids.map((id) => ({ id, label: libraryLabel(libraries, id), color: LIBRARY_COLOR[id] }));
}

export interface LegendEntry {
  label: string;
  color: string;
  self?: boolean;
}

/** Build a chart's legend entries (for the real-HTML legend in ChartCard). */
export function legendFor(libraries: LibraryMeta[], ids: readonly LibraryId[]): LegendEntry[] {
  return ids.map((id) => ({
    label: libraryLabel(libraries, id),
    color: LIBRARY_COLOR[id],
    self: id === 'lightning-yaml',
  }));
}

/** SpeedWorkload[] -> GroupedGroup[], reading the `avg` stat per library. */
export function speedGroups(workloads: SpeedWorkload[]): GroupedGroup[] {
  return workloads.map((w) => ({
    label: w.workload,
    values: Object.fromEntries(Object.entries(w.values).map(([id, stat]) => [id, (stat as SpeedStat).avg])),
  }));
}

/** MemoryWorkload[] -> GroupedGroup[], reading the `peak_rss` stat per library. */
export function memoryGroups(workloads: MemoryWorkload[]): GroupedGroup[] {
  return workloads.map((w) => ({
    label: w.workload,
    values: Object.fromEntries(Object.entries(w.values).map(([id, stat]) => [id, (stat as MemoryStat).peak_rss])),
  }));
}

/** ConformanceResult[] -> BarItem[], sorted best-first (higher_is_better). */
export function conformanceItems(results: ConformanceResult[]): BarItem[] {
  return [...results]
    .sort((a, b) => b.score - a.score)
    .map((r) => ({
      id: r.id,
      label: withVersion(r.label, r.version),
      value: r.score,
      color: LIBRARY_COLOR[r.id],
      self: Boolean(r.self),
      sublabel: `${r.passed}/${r.total}`,
    }));
}

/** Round a positive value up to a clean gridline step — used for a byte-valued chart's axis ceiling. */
export function niceDomainMax(maxValue: number, step: number): number {
  return Math.ceil(Math.max(maxValue, step) / step) * step;
}

/** Round up to the nearest 1/2/5 × 10^n — a clean axis ceiling when there's no natural step. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

// Every rule inline: this HTML is injected into an .mdx page via `set:html`,
// and MDX parses literal `{`/`}` in its JSX children as expression syntax —
// a real <style> block full of CSS braces is a build-error risk there, and
// MDX files can't use Astro's scoped-style mechanism (SFC-only) either. So
// the tables carry their own presentation, no external stylesheet needed.
//
// Colors here are Starlight's OWN theme-aware tokens (--sl-color-text,
// --sl-color-gray-3, --sl-color-hairline), NOT the --ly-ink/--ly-muted/--ly-line
// brand tokens the charts use. The charts sit inside an explicitly dark
// --ly-panel card (ChartCard.astro), where --ly-ink/--ly-muted are correctly
// scoped ("text on dark" per theme.css). This table sits directly on the
// ordinary page surface, which is light in light mode — using the dark-only
// --ly-* text colors there washes out to near-invisible in light mode.
const TD_STYLE = 'padding:0.4rem 0.65rem;border-bottom:1px solid var(--sl-color-hairline);' +
  'text-align:right;white-space:nowrap;font-family:var(--sl-font-mono)';
const TH_ROW_STYLE = 'padding:0.4rem 0.65rem;border-bottom:1px solid var(--sl-color-hairline);' +
  'text-align:left;white-space:nowrap;font-family:var(--sl-font-mono);color:var(--sl-color-text);font-weight:400';
const TH_COL_STYLE = 'padding:0.4rem 0.65rem;border-bottom:1px solid var(--sl-color-hairline);' +
  'text-align:right;white-space:nowrap;color:var(--sl-color-gray-3);font-weight:600';
const TH_COL_FIRST_STYLE = TH_COL_STYLE.replace('text-align:right', 'text-align:left');
const TABLE_STYLE = 'width:100%;border-collapse:collapse;font-size:0.85rem';
// Category sub-header row inside a grouped breakdown table.
const TH_GROUP_STYLE = 'padding:0.7rem 0.65rem 0.3rem;border-bottom:1px solid var(--sl-color-hairline);' +
  'text-align:left;white-space:nowrap;font-family:var(--sl-font-mono);color:var(--sl-color-gray-3);' +
  'font-weight:600;font-size:0.82em;letter-spacing:0.02em';

/**
 * The "table view" twin for a speed chart (parse OR stringify — every workload,
 * every library) — the dataviz skill requires every chart have one, and it's
 * also where cross-workload comparison lives: the charts scale each row
 * independently, so this table is the one place to read raw values across
 * rows. Returns a ready `<table>` string for `set:html`; built here (not as inline MDX
 * JSX with nested `.map()`s) to keep escaping in one place and avoid MDX's
 * blank-line/indentation gotchas around nested JSX loops.
 */
export function speedTableHtml(workloads: SpeedWorkload[], libraries: LibraryMeta[], order: readonly LibraryId[]): string {
  const head = order
    .map((id) => `<th scope="col" style="${TH_COL_STYLE}">${escapeXml(libraryLabel(libraries, id))}</th>`)
    .join('');
  const rows = workloads
    .map((w) => {
      const cells = order
        .map((id) => {
          const stat = w.values[id];
          const text = stat ? formatNs(stat.avg) : '—';
          return `<td style="${TD_STYLE}">${text}</td>`;
        })
        .join('');
      return `<tr><th scope="row" style="${TH_ROW_STYLE}">${escapeXml(w.workload)}</th>${cells}</tr>`;
    })
    .join('');
  return (
    `<table style="${TABLE_STYLE}"><thead><tr><th scope="col" style="${TH_COL_FIRST_STYLE}">Workload</th>${head}</tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/** The "table view" twin for the conformance chart. */
export function conformanceTableHtml(results: ConformanceResult[]): string {
  const rows = [...results]
    .sort((a, b) => b.score - a.score)
    .map(
      (r) =>
        `<tr><th scope="row" style="${TH_ROW_STYLE}">${escapeXml(withVersion(r.label, r.version))}</th>` +
        `<td style="${TD_STYLE}">${r.passed}</td>` +
        `<td style="${TD_STYLE}">${r.total}</td>` +
        `<td style="${TD_STYLE}">${formatPercent(r.score)}</td></tr>`,
    )
    .join('');
  return (
    `<table style="${TABLE_STYLE}"><thead><tr><th scope="col" style="${TH_COL_FIRST_STYLE}">Library</th>` +
    `<th scope="col" style="${TH_COL_STYLE}">Passed</th>` +
    `<th scope="col" style="${TH_COL_STYLE}">Total</th><th scope="col" style="${TH_COL_STYLE}">Score</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/** The "table view" twin for the bundle-size chart — every bundler, every library, gzip (min alongside). */
export function bundleSizeTableHtml(doc: BundleSizeDoc): string {
  const order = LIBRARY_ORDER.filter((id) => doc.libraries.some((l) => l.id === id));
  const head = order
    .map((id) => `<th scope="col" style="${TH_COL_STYLE}">${escapeXml(libraryLabel(doc.libraries, id))}</th>`)
    .join('');
  const rows = doc.results
    .map((r) => {
      const cells = order
        .map((id) => {
          const v = r.values[id];
          if (!v || v.error || typeof v.gzip !== 'number') return `<td style="${TD_STYLE}">—</td>`;
          const sub = typeof v.min === 'number' ? ` <span style="color:var(--sl-color-gray-3)">(${formatKB(v.min)} min)</span>` : '';
          return `<td style="${TD_STYLE}">${formatKB(v.gzip)}${sub}</td>`;
        })
        .join('');
      const bundlerLabel = r.rust ? `${r.bundler} (rust)` : r.bundler;
      return `<tr><th scope="row" style="${TH_ROW_STYLE}">${escapeXml(bundlerLabel)}</th>${cells}</tr>`;
    })
    .join('');
  return (
    `<table style="${TABLE_STYLE}"><thead><tr><th scope="col" style="${TH_COL_FIRST_STYLE}">Bundler</th>${head}</tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/**
 * Breakdown table for a speed OR memory operation: every workload, grouped into
 * WORKLOAD_CATEGORIES under a labelled section row. `cell` turns a per-library
 * stat into its display string (avg ns for speed, peak RSS MB for memory); a
 * missing library renders `—`. Built as a string for `set:html`, same as the
 * other table helpers. Kept generic so speed and memory share one renderer.
 */
export function groupedBreakdownTableHtml<T extends { workload: string; values: Partial<Record<LibraryId, unknown>> }>(
  workloads: T[],
  libraries: LibraryMeta[],
  order: readonly LibraryId[],
  cell: (stat: unknown) => string,
): string {
  const byName = new Map(workloads.map((w) => [w.workload, w] as const));
  const head = order
    .map((id) => `<th scope="col" style="${TH_COL_STYLE}">${escapeXml(libraryLabel(libraries, id))}</th>`)
    .join('');
  const colSpan = order.length + 1;
  const seen = new Set<string>();
  const rowFor = (w: T): string => {
    const cells = order
      .map((id) => `<td style="${TD_STYLE}">${w.values[id] != null ? escapeXml(cell(w.values[id])) : '—'}</td>`)
      .join('');
    return `<tr><th scope="row" style="${TH_ROW_STYLE}">${escapeXml(w.workload)}</th>${cells}</tr>`;
  };
  const groupRow = (label: string): string =>
    `<tr><th scope="colgroup" colspan="${colSpan}" style="${TH_GROUP_STYLE}">${escapeXml(label)}</th></tr>`;

  const sections = WORKLOAD_CATEGORIES.map((cat) => {
    const rows = cat.workloads
      .map((name) => byName.get(name))
      .filter((w): w is T => Boolean(w))
      .map((w) => {
        seen.add(w.workload);
        return rowFor(w);
      })
      .join('');
    return rows ? groupRow(cat.label) + rows : '';
  }).join('');

  const leftover = workloads.filter((w) => !seen.has(w.workload));
  const leftoverSection = leftover.length ? groupRow('Other') + leftover.map(rowFor).join('') : '';

  return (
    `<table style="${TABLE_STYLE}"><thead><tr><th scope="col" style="${TH_COL_FIRST_STYLE}">Workload</th>${head}</tr></thead>` +
    `<tbody>${sections}${leftoverSection}</tbody></table>`
  );
}

/** Grouped breakdown for a speed operation — avg ns per iteration. */
export function speedBreakdownHtml(workloads: SpeedWorkload[], libraries: LibraryMeta[], order: readonly LibraryId[]): string {
  return groupedBreakdownTableHtml(workloads, libraries, order, (s) => formatNs((s as SpeedStat).avg));
}

/** Grouped breakdown for a memory operation — peak RSS in MB. */
export function memoryBreakdownHtml(workloads: MemoryWorkload[], libraries: LibraryMeta[], order: readonly LibraryId[]): string {
  return groupedBreakdownTableHtml(workloads, libraries, order, (s) => formatMB((s as MemoryStat).peak_rss));
}

// ---------------------------------------------------------------------------
// Brand palette — one color per library, reused identically across every
// chart on the page so identity ("violet = lightning-yaml") only has to be
// learned once. Values are the --ly-* custom properties defined in theme.css.
// ---------------------------------------------------------------------------

export const LIBRARY_COLOR: Record<LibraryId, string> = {
  'lightning-yaml': 'var(--ly-charge)', // self / hero
  yaml: 'var(--ly-spark)',
  'js-yaml': 'var(--ly-amber)',
  // A js-yaml variant (dump with the lean CORE schema), so a soft amber marks
  // it as the same family as js-yaml, distinguishable beside it. Stringify only.
  'js-yaml-tuned': 'var(--ly-amber-soft)',
  JSON: 'var(--ly-muted)', // baseline, when present
};

/**
 * Workload → display category for the grouped breakdown tables. Array order is
 * section order; the names mirror the fixture categories in
 * bench/fixtures/datasets.ts (JSON-shaped records/nested, plain block YAML, and
 * rich YAML with anchors + `!!binary`). Any workload not listed still renders,
 * in a trailing "Other" group (see groupedBreakdownTableHtml).
 */
export const WORKLOAD_CATEGORIES: ReadonlyArray<{ label: string; workloads: readonly string[] }> = [
  {
    label: 'JSON-shaped (records & nested)',
    workloads: ['small-records', 'medium-records', 'large-records', 'xlarge-records', 'medium-nested', 'large-nested'],
  },
  {
    label: 'Plain block YAML',
    workloads: ['yaml-plain-small-records', 'yaml-plain-medium-records', 'yaml-plain-large-records', 'yaml-plain-medium-nested'],
  },
  {
    label: 'Rich YAML (anchors + !!binary)',
    workloads: ['yaml-rich-small', 'yaml-rich-medium', 'yaml-rich-large'],
  },
];

/**
 * The subset of `order` with at least one value across `workloads`. Keeps a
 * chart/legend from listing a library that has no bar in it — e.g. the tuned
 * js-yaml row (stringify only) must not show up on the parse or memory charts,
 * and JSON must not show up where a workload is YAML-only.
 */
export function presentIn(
  order: readonly LibraryId[],
  workloads: ReadonlyArray<{ values: Partial<Record<LibraryId, unknown>> }>,
): LibraryId[] {
  return order.filter((id) => workloads.some((w) => w.values[id] != null));
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

function fixedByMagnitude(v: number): string {
  const decimals = v < 10 ? 2 : v < 100 ? 1 : 0;
  return v.toFixed(decimals);
}

/** ns -> human units for a DATA label, e.g. `15.6 µs`, `196 ms`, `9.89 s`. */
export function formatNs(ns: number): string {
  if (ns >= 1e9) return `${fixedByMagnitude(ns / 1e9)} s`;
  if (ns >= 1e6) return `${fixedByMagnitude(ns / 1e6)} ms`;
  if (ns >= 1e3) return `${fixedByMagnitude(ns / 1e3)} µs`;
  return `${Math.round(ns)} ns`;
}

/** MB -> data label, e.g. `91.2 MB`, `2744 MB`. */
export function formatMB(mb: number): string {
  return `${fixedByMagnitude(mb)} MB`;
}

/** Percent -> data label, e.g. `97.6%`. */
export function formatPercent(v: number): string {
  return `${v.toFixed(1)}%`;
}

/** bytes -> KB data label, e.g. `12.0 KB`. */
export function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Ratio -> data label, normalized to the fastest/best in a row, e.g. `1.0×`, `9.8×`, `101×`. */
export function formatRatio(r: number): string {
  return `${r < 10 ? r.toFixed(1) : Math.round(r)}×`;
}

/**
 * `formatRatio` typed to take groupedBreakdownTableHtml's `cell: (stat: unknown) => string`
 * shape directly — MDX's expression parser (oxc) rejects a TS `as` cast written
 * inline in a .mdx file's `{}` JSX expressions, so this exists purely so
 * benchmarks.mdx can pass it as a plain function reference instead.
 */
export function formatRatioCell(stat: unknown): string {
  return formatRatio(stat as number);
}

/** Labels are untrusted-shaped data (come from YAML, not literals) — escape for XML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Round an SVG coordinate to keep the markup compact and diff-friendly. */
function fx(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// HeroBench — bar rows for the hero's four-tab instrument. `buildChart`
// builds the Bundle size tab's bars (absolute KB, no off-scale clamp — sizes
// are deterministic and don't blow out the way a workload comparison can).
// `ratioBarRows` builds Parse/Dump/Memory: every bar is one real measurement
// in its suite's own canonical environment, never blended across
// environments (see queries.ts's "Ratio queries" section for why). A
// native-popover breakdown on every non-baseline bar lists each
// environment's own ratio the same way. Its rows scale to their own largest
// entry, clipping an outlier that runs away from the field (>3× the
// runner-up) so the rest stays legible — `clampOffScale` lets callers
// (Parse/Dump vs. Memory) opt in or out per suite.
// ---------------------------------------------------------------------------

export interface HeroChartRow {
  name: string;
  values: Partial<Record<LibraryId, number>>;
}

/**
 * One bar in a hero group, shared by both `buildChart` (absolute) and
 * `ratioBarRows` (ratio) so a template can render either without a type
 * discriminant: `buildChart`'s bars simply never set `popoverId`.
 */
export interface HeroBar {
  id: LibraryId;
  color: string;
  label: string;
  width: number;
  over: boolean;
  self: boolean;
  /** Set together on a ratio bar with an inspectable breakdown — pair with a `<div popover>` built from `popoverHtml` (see HeroBench.astro). Absent on every `buildChart` bar. */
  popoverId?: string;
  popoverHtml?: string;
}

/** Bundle-size bar rows for the hero's Bundle size tab — the only caller (bundle sizes are the one absolute, environment-free tab). */
export function buildChart(rows: HeroChartRow[], order: readonly LibraryId[]): { name: string; bars: HeroBar[] }[] {
  return rows.map((r) => {
    const present = order.filter((id) => typeof r.values[id] === 'number');
    const max = Math.max(...present.map((id) => r.values[id] as number));
    const bars = present.map((id): HeroBar => {
      const v = r.values[id] as number;
      return {
        id,
        color: LIBRARY_COLOR[id],
        label: formatKB(v),
        width: (v / max) * 100,
        over: false,
        self: id === 'lightning-yaml',
      };
    });
    return { name: r.name, bars };
  });
}

/**
 * Build-time content for a ratio's `[popover]` breakdown: every environment's
 * OWN measured ratio, listed separately — never combined into one figure.
 * "Per-engine results" heads the list so it reads as raw measurements, not a
 * statistic. Returns the popover's inner HTML; the caller supplies the
 * wrapping element (`id`, the `popover` attribute) — see HeroBench.astro.
 */
export function ratioPopoverHtml(points: readonly RatioPoint[], title: string): string {
  const rows = points
    .map((r) => {
      const env = r.methodLabel
        ? `${escapeXml(r.runtime)} <span class="ratio-pop__method">· ${escapeXml(r.methodLabel)}</span>`
        : escapeXml(r.runtime);
      return `<li><span class="ratio-pop__env">${env}</span>` + `<span class="ratio-pop__val">${escapeXml(formatRatio(r.ratio))}</span></li>`;
    })
    .join('');
  return (
    `<div class="ratio-pop__title">${escapeXml(title)}</div>` +
    `<div class="ratio-pop__sub">Per-engine results</div>` +
    `<ul class="ratio-pop__list">${rows}</ul>`
  );
}

export interface RatioRow {
  name: string;
  /** The canonical environment's own ratio per library, keyed by id — THE headline number (includes `lightning-yaml` itself, always ratio 1). */
  ratios: Partial<Record<LibraryId, number>>;
  /** Every environment's own ratio per library, keyed by id — feeds the popover breakdown only, never the bar's headline number. */
  points: Partial<Record<LibraryId, RatioPoint[]>>;
}

/**
 * Ratio-native bar builder: every bar is one real measurement in the
 * canonical environment — see queries.ts's "Ratio queries" section for why
 * it's never blended. A ratio is the row's absolute value already divided by
 * a per-row constant (lightning-yaml's own figure), so scaling bar width by
 * ratio magnitude produces the same proportions scaling by the original
 * absolute values would — only the printed label changes (`×` instead of a
 * unit). Every bar except the 1.0× self baseline gets a
 * `popoverId`/`popoverHtml` pair listing each environment's own ratio (see
 * HeroBench.astro).
 */
export function ratioBarRows(
  rows: RatioRow[],
  order: readonly LibraryId[],
  idPrefix: string,
  titleFor: (rowName: string, id: LibraryId) => string,
  clampOffScale: boolean,
): { name: string; bars: HeroBar[] }[] {
  return rows.map((r, ri) => {
    const present = order.filter((id) => typeof r.ratios[id] === 'number' && Number.isFinite(r.ratios[id]));
    const vals = present.map((id) => r.ratios[id] as number);
    const max = Math.max(...vals);
    const sorted = [...vals].sort((a, b) => a - b);
    const second = sorted.length > 1 ? sorted[sorted.length - 2] : max;
    const clamp = clampOffScale && max > second * 3;
    const ceiling = clamp ? second * 1.18 : max;
    const bars: HeroBar[] = present.map((id) => {
      const v = r.ratios[id] as number;
      const over = clamp && v > ceiling;
      const self = id === 'lightning-yaml';
      const popoverId = self ? undefined : `${idPrefix}-${ri}-${id}`;
      return {
        id,
        color: LIBRARY_COLOR[id],
        label: formatRatio(v),
        width: over ? 100 : Math.min(100, (v / ceiling) * 100),
        over,
        self,
        popoverId,
        popoverHtml: popoverId ? ratioPopoverHtml(r.points[id] ?? [], titleFor(r.name, id)) : undefined,
      };
    });
    return { name: r.name, bars };
  });
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

type Scale = (v: number) => number;

function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

// ---------------------------------------------------------------------------
// Bar geometry — a horizontal bar with a 4px rounded "data end" (the tip)
// and a square baseline end, per the dataviz skill's mark spec.
// ---------------------------------------------------------------------------

function hBarPath(x0: number, x1: number, y0: number, y1: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, x1 - x0, (y1 - y0) / 2));
  if (r < 0.05) {
    return `M${fx(x0)},${fx(y0)} L${fx(x1)},${fx(y0)} L${fx(x1)},${fx(y1)} L${fx(x0)},${fx(y1)} Z`;
  }
  return [
    `M${fx(x0)},${fx(y0)}`,
    `L${fx(x1 - r)},${fx(y0)}`,
    `Q${fx(x1)},${fx(y0)} ${fx(x1)},${fx(y0 + r)}`,
    `L${fx(x1)},${fx(y1 - r)}`,
    `Q${fx(x1)},${fx(y1)} ${fx(x1 - r)},${fx(y1)}`,
    `L${fx(x0)},${fx(y1)}`,
    'Z',
  ].join(' ');
}

/**
 * CSS shared by every chart's embedded <style>. Fixed (not media-query
 * scaled): SVG text lives in the same coordinate space as the geometry, so
 * enlarging it at narrow viewports risks the longest workload labels
 * clipping past the viewBox edge. Proportional shrink on mobile is the safer
 * failure mode — nothing clips or overlaps — and every value is also in the
 * summary table below. Identical rules are repeated per chart on purpose:
 * each returned string is a fully self-contained <svg>.
 */
function chartStyle(): string {
  return (
    `.ly-cat{font:11px var(--sl-font-mono);fill:var(--ly-muted)}` +
    `.ly-axis{font:10px var(--sl-font-mono);fill:var(--ly-muted)}` +
    `.ly-val{font:10.5px var(--sl-font-mono);fill:var(--ly-ink)}` +
    `.ly-val--self{font-weight:600}` +
    `.ly-sub{font:9.5px var(--sl-font-mono);fill:var(--ly-muted)}`
  );
}

function glowFilter(id: string): string {
  return (
    `<filter id="${id}-glow" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="1.7" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>`
  );
}

function svgOpen(id: string, w: number, h: number, title: string): string {
  return (
    `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(title)}" ` +
    `aria-labelledby="${id}-t ${id}-d" style="width:100%;max-width:100%;height:auto;display:block" ` +
    `xmlns="http://www.w3.org/2000/svg">`
  );
}

// ---------------------------------------------------------------------------
// groupedBarSVG — N workloads x M libraries. Each workload is scaled to its
// OWN slowest parser (linear), so within a row bar length is proportional to
// the value — lightning-yaml being ~50x faster reads as a ~50x shorter bar.
// Why per-row and not one shared axis: the data spans ~6 orders of magnitude
// across workloads (µs to s), so a shared linear axis crushes the small
// workloads to sub-pixel, and a log axis compresses the very ratios the chart
// exists to show. The cost is that rows aren't comparable to each other — so
// every bar carries its exact value label and the card note states the
// per-workload scaling. Legend + note render as real HTML around the <svg>
// (ChartCard.astro) so text reflows and never clips.
// ---------------------------------------------------------------------------

export interface GroupedSeries {
  id: string;
  label: string;
  color: string;
}

export interface GroupedGroup {
  label: string;
  values: Partial<Record<string, number>>;
}

export interface GroupedBarOptions {
  id: string;
  title: string;
  series: GroupedSeries[];
  groups: GroupedGroup[];
  unit: 'ns' | 'MB';
  lowerIsBetter: boolean;
  /**
   * 'value' (default) labels each bar with its formatted value (e.g. `196 ms`).
   * 'ratio-to-best' labels each bar with its value relative to the fastest
   * series in that row (e.g. `1.0×`, `9.8×`) — bar geometry is unchanged
   * either way, this only changes the text drawn beside the bar.
   */
  labelStyle?: 'value' | 'ratio-to-best';
}

export function groupedBarSVG(opts: GroupedBarOptions): string {
  const { id, title, series, groups, unit, lowerIsBetter, labelStyle = 'value' } = opts;
  const formatValue = unit === 'ns' ? formatNs : formatMB;

  const W = 620;
  const marginTop = 14;
  const marginBottom = 10;
  const marginLeft = 190;
  // Holds the value label of the slowest (full-width) bar in each row; its tip
  // sits at the plot's right edge, so this IS the worst-case label budget.
  const marginRight = 72;
  const barH = 15;
  const barGap = 2;
  const rowH = barH + barGap;
  const groupGapExtra = 12;
  const groupH = series.length * rowH + groupGapExtra;
  const plotW = W - marginLeft - marginRight;
  const plotH = groups.length * groupH;
  const H = marginTop + plotH + marginBottom;
  const plotX = marginLeft;
  const plotY = marginTop;

  const groupsSvg = groups
    .map((g, gi) => {
      const gy = plotY + gi * groupH;
      // Per-workload linear scale: 0 .. this row's slowest parser. The `1`
      // floor only guards the empty-row case (Math.max() -> -Infinity); real
      // ns/MB values are far larger, so it never clamps a genuine bar.
      const groupMax = Math.max(
        ...series.map((s) => g.values[s.id]).filter((v): v is number => typeof v === 'number' && v > 0),
        1,
      );
      // Fastest-in-row, for 'ratio-to-best' labels. Only consulted when at
      // least one positive value exists in the row (guaranteed for any `v`
      // the label loop below actually renders), so it's never Infinity there.
      const rowMin = Math.min(
        ...series.map((s) => g.values[s.id]).filter((v): v is number => typeof v === 'number' && v > 0),
      );
      const scale = linearScale([0, groupMax], [0, plotW]);
      const rows = series
        .map((s, si) => {
          const v = g.values[s.id];
          if (typeof v !== 'number') return '';
          const y0 = gy + si * rowH;
          const y1 = y0 + barH;
          const x1 = plotX + scale(v);
          const path = hBarPath(plotX, x1, y0, y1, 4);
          const isSelf = s.id === 'lightning-yaml';
          const glow = isSelf ? ` filter="url(#${id}-glow)"` : '';
          const valClass = isSelf ? 'ly-val ly-val--self' : 'ly-val';
          const labelText = labelStyle === 'ratio-to-best' ? formatRatio(v / rowMin) : formatValue(v);
          return (
            `<path d="${path}" fill="${s.color}"${glow}/>` +
            `<text x="${fx(x1 + 6)}" y="${fx((y0 + y1) / 2)}" class="${valClass}" dominant-baseline="middle">${escapeXml(labelText)}</text>`
          );
        })
        .join('');
      const labelY = gy + (series.length * rowH - barGap) / 2;
      return (
        rows +
        `<text x="${fx(plotX - 12)}" y="${fx(labelY)}" class="ly-cat" text-anchor="end" dominant-baseline="middle">${escapeXml(g.label)}</text>`
      );
    })
    .join('');

  // Single origin rule at x=0 to ground every row's bars. There is no numeric
  // x-axis: each row has its own scale, so a shared axis would be wrong — the
  // exact value label beside each bar is the scale.
  const baseline = `<line x1="${fx(plotX)}" y1="${fx(plotY)}" x2="${fx(plotX)}" y2="${fx(plotY + plotH)}" stroke="var(--ly-line)" stroke-width="1"/>`;

  const dir = lowerIsBetter ? 'lower is better' : 'higher is better';
  const measure = unit === 'ns' ? 'time' : 'memory';
  const labelDesc =
    labelStyle === 'ratio-to-best'
      ? `every bar is labelled with its ${measure} relative to the fastest parser in that row (×)`
      : 'every bar is labelled with its exact value';
  const descText = `${title} — ${dir}. Each workload is scaled to its own slowest parser, so bar length is proportional to ${measure} within a row; rows are not comparable to each other, and ${labelDesc}. Series: ${series.map((s) => s.label).join(', ')}. ${groups.length} workloads: ${groups.map((g) => g.label).join(', ')}.`;

  return (
    svgOpen(id, W, H, title) +
    `<title id="${id}-t">${escapeXml(title)}</title>` +
    `<desc id="${id}-d">${escapeXml(descText)}</desc>` +
    `<defs>${glowFilter(id)}</defs>` +
    `<style>${chartStyle()}</style>` +
    baseline +
    groupsSvg +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// barSVG — single value per row (conformance pass rate), self row emphasised.
// Each row is directly labelled with its own library name, so — per the
// dataviz skill's "a single series needs no legend box" rule — there's no
// separate legend: identity is already 1:1 with the label beside each bar.
// ---------------------------------------------------------------------------

export interface BarOptions {
  id: string;
  title: string;
  items: BarItem[];
  higherIsBetter: boolean;
  domainMax?: number;
  unitSuffix?: string;
  /** Per-bar value label. Defaults to `formatPercent` (conformance's pass-rate chart). */
  formatValue?: (v: number) => string;
  /** Axis tick label. Defaults to the rounded tick value + `unitSuffix`. */
  formatTick?: (v: number) => string;
}

export function barSVG(opts: BarOptions): string {
  const {
    id,
    title,
    items,
    higherIsBetter,
    domainMax = 100,
    unitSuffix = '%',
    formatValue = formatPercent,
    formatTick = (t: number) => `${Math.round(t)}${unitSuffix}`,
  } = opts;
  const W = 620;
  const marginTop = 8;
  const marginBottom = 24;
  const marginLeft = 150;
  // Generous on purpose: at value=domainMax the bar tip sits exactly at the
  // plot/margin boundary, so marginRight IS the worst-case label budget for
  // "100.0% (373/373)" — verified against a real render, not just estimated
  // (an earlier, tighter margin clipped the sublabel in a screenshot check).
  const marginRight = 145;
  const barH = 20;
  const barGap = 16;
  const rowH = barH + barGap;
  const plotW = W - marginLeft - marginRight;
  const plotH = items.length * rowH - barGap;
  const H = marginTop + plotH + marginBottom;
  const plotY = marginTop;

  const scale = linearScale([0, domainMax], [0, plotW]);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (domainMax / tickCount) * i);

  const gridSvg = ticks
    .map((t) => {
      const x = marginLeft + scale(t);
      return (
        `<line x1="${fx(x)}" y1="${fx(plotY)}" x2="${fx(x)}" y2="${fx(plotY + plotH)}" stroke="var(--ly-line)" stroke-width="1"/>` +
        `<text x="${fx(x)}" y="${fx(plotY + plotH + 16)}" class="ly-axis" text-anchor="middle">${escapeXml(formatTick(t))}</text>`
      );
    })
    .join('');

  const rowsSvg = items
    .map((it, i) => {
      const y0 = plotY + i * rowH;
      const y1 = y0 + barH;
      const x1 = marginLeft + scale(it.value);
      const path = hBarPath(marginLeft, x1, y0, y1, 4);
      const glow = it.self ? ` filter="url(#${id}-glow)"` : '';
      const valClass = it.self ? 'ly-val ly-val--self' : 'ly-val';
      const sub = it.sublabel ? ` <tspan class="ly-sub">(${escapeXml(it.sublabel)})</tspan>` : '';
      return (
        `<text x="${fx(marginLeft - 10)}" y="${fx((y0 + y1) / 2)}" class="ly-cat" text-anchor="end" dominant-baseline="middle">${escapeXml(it.label)}</text>` +
        `<path d="${path}" fill="${it.color}"${glow}/>` +
        `<text x="${fx(x1 + 8)}" y="${fx((y0 + y1) / 2)}" class="${valClass}" dominant-baseline="middle">${escapeXml(formatValue(it.value))}${sub}</text>`
      );
    })
    .join('');

  const dir = higherIsBetter ? 'higher is better' : 'lower is better';
  const descText = `${title} — ${dir}. ${items.map((it) => `${it.label} ${formatValue(it.value)}`).join(', ')}.`;

  return (
    svgOpen(id, W, H, title) +
    `<title id="${id}-t">${escapeXml(title)}</title>` +
    `<desc id="${id}-d">${escapeXml(descText)}</desc>` +
    `<defs>${glowFilter(id)}</defs>` +
    `<style>${chartStyle()}</style>` +
    gridSvg +
    rowsSvg +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Time-series ("trend") — one line per library across the append-only run
// history (every '---' document in a *.yaml stream, oldest → newest). Built at
// build time as a static inline SVG, same as the bar charts. Locally the
// committed seed holds a single run, so a trend renders one dot; in production
// the `benchmark-data` overlay supplies the full history and it renders as
// lines. See the lib header + CLAUDE.md "Benchmarking rules".
//
// x is RUN INDEX, evenly spaced — not a literal date axis. Runs are unevenly
// timed and several land on the same day, so a date-proportional axis would
// clump them illegibly; a handful of ticks carry the dates instead. y differs
// per suite (see the trend adapters below): speed is machine-noisy, so its
// trend is a RATIO to the fastest parser that run (the same machine-invariant
// figure the bar charts use); memory/conformance/bundle-size are stable, so
// they trend as absolute values.
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** Run index, 0-based, chronological. */
  i: number;
  y: number;
  /** The run's `generated` date, for the point's hover tooltip. */
  date?: string;
  /** The library's version in this run, where the suite recorded one — drives the hover tooltip and version-change marker. */
  version?: string;
}

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
  self?: boolean;
  points: TrendPoint[];
}

export interface XTick {
  i: number;
  label: string;
}

/** Each run's `generated` date string, in chronological (append) order. */
export function runDates(runs: ReadonlyArray<{ generated?: unknown }>): string[] {
  return runs.map((r) => String(r.generated ?? ''));
}

/** ~4 evenly spaced x-axis tick positions with date labels (all of them when there are few runs). */
export function xTicks(dates: readonly string[]): XTick[] {
  const n = dates.length;
  if (n === 0) return [];
  if (n <= 5) return dates.map((label, i) => ({ i, label }));
  const positions = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return [...new Set(positions)].map((i) => ({ i, label: dates[i] }));
}

/** Legend entries (real-HTML legend in ChartCard) matching a trend chart's series. */
export function trendLegend(series: TrendSeries[]): LegendEntry[] {
  return series.map((s) => ({ label: s.label, color: s.color, self: Boolean(s.self) }));
}

function trendMeta(id: LibraryId, label: string): Pick<TrendSeries, 'id' | 'label' | 'color' | 'self'> {
  return { id, label, color: LIBRARY_COLOR[id], self: id === 'lightning-yaml' };
}

/**
 * Speed trend for one workload: y = a library's `avg` divided by the FASTEST
 * `avg` in that same workload+run (ratio-to-best, ≥ 1). Absolute ns drift with
 * CI-runner noise, so only this ratio is machine-invariant — the fastest parser
 * sits at 1× by construction (the reference), matching the bar chart's labels.
 */
export function speedTrend(
  runs: SpeedDoc[],
  op: 'parse' | 'stringify',
  workload: string,
  order: readonly LibraryId[],
): TrendSeries[] {
  const labels = runs.at(-1)?.libraries ?? [];
  return order
    .map((id) => {
      const points: TrendPoint[] = [];
      runs.forEach((run, i) => {
        const w = run.operations?.[op]?.find((x) => x.workload === workload);
        if (!w) return;
        const avgs = order
          .map((lid) => w.values[lid]?.avg)
          .filter((v): v is number => typeof v === 'number' && v > 0);
        const stat = w.values[id];
        if (!avgs.length || !stat || typeof stat.avg !== 'number' || stat.avg <= 0) return;
        points.push({ i, y: stat.avg / Math.min(...avgs), date: String(run.generated ?? ''), version: run.libraries?.find((l) => l.id === id)?.version });
      });
      return { ...trendMeta(id, libraryLabel(labels, id)), points };
    })
    .filter((s) => s.points.length > 0);
}

/** Memory trend for one operation + workload: y = absolute peak RSS (MB) — the repo's stable memory figure. */
export function memoryTrend(
  runs: MemoryDoc[],
  op: 'parse' | 'stringify',
  workload: string,
  order: readonly LibraryId[],
): TrendSeries[] {
  const labels = runs.at(-1)?.libraries ?? [];
  return order
    .map((id) => {
      const points: TrendPoint[] = [];
      runs.forEach((run, i) => {
        const stat = run.operations?.[op]?.find((x) => x.workload === workload)?.values[id];
        if (stat && typeof stat.peak_rss === 'number') points.push({ i, y: stat.peak_rss, date: String(run.generated ?? ''), version: run.libraries?.find((l) => l.id === id)?.version });
      });
      return { ...trendMeta(id, libraryLabel(labels, id)), points };
    })
    .filter((s) => s.points.length > 0);
}

/** Conformance trend: y = pass rate (%). Deterministic, so plotted absolute. */
export function conformanceTrend(runs: ConformanceDoc[], order: readonly LibraryId[]): TrendSeries[] {
  const labels = new Map((runs.at(-1)?.results ?? []).map((r) => [r.id, withVersion(r.label, r.version)] as const));
  return order
    .map((id) => {
      const points: TrendPoint[] = [];
      runs.forEach((run, i) => {
        const r = run.results?.find((x) => x.id === id);
        if (r && typeof r.score === 'number') points.push({ i, y: r.score, date: String(run.generated ?? ''), version: r.version });
      });
      return { ...trendMeta(id, labels.get(id) ?? id), points };
    })
    .filter((s) => s.points.length > 0);
}

/** Bundle-size trend: y = smallest gzip across bundlers that run, in BYTES (format with formatKB). */
export function bundleSizeTrend(runs: BundleSizeDoc[], order: readonly LibraryId[]): TrendSeries[] {
  const labels = runs.at(-1)?.libraries ?? [];
  return order
    .map((id) => {
      const points: TrendPoint[] = [];
      runs.forEach((run, i) => {
        const gzips = (run.results ?? [])
          .map((r) => r.values[id])
          .filter((v): v is BundleSizeValue => Boolean(v) && typeof v!.gzip === 'number')
          .map((v) => v.gzip as number);
        if (gzips.length) points.push({ i, y: Math.min(...gzips), date: String(run.generated ?? ''), version: run.libraries?.find((l) => l.id === id)?.version });
      });
      return { ...trendMeta(id, libraryLabel(labels, id)), points };
    })
    .filter((s) => s.points.length > 0);
}

// ---------------------------------------------------------------------------
// lineChartSVG — the trend renderer. Shared y-axis (all series comparable, one
// metric), evenly spaced run-index x-axis with a few date ticks. The self
// series (lightning-yaml) is drawn thicker + glowed for the same 1:1 identity
// the bar charts use. n == 1 (the committed seed) degrades to a single dot.
// ---------------------------------------------------------------------------

export interface LineChartOptions {
  id: string;
  title: string;
  series: TrendSeries[];
  ticks: XTick[];
  /** Total run count; the x-domain is [0, n-1] regardless of any per-series gaps. */
  n: number;
  yFormat: (v: number) => string;
  higherIsBetter: boolean;
  domainMin?: number;
  domainMax?: number;
  /**
   * 'log' (base 10) for wide-dynamic-range data — the speed trends compare a
   * ratio-to-fastest that spans ~1× to ~130× across libraries, where a linear
   * axis crushes the fast parsers into an unreadable sliver at the baseline and
   * hides exactly the run-to-run movement the chart exists to show. Only valid
   * for strictly-positive series (ratios are ≥ 1). Defaults to 'linear'.
   */
  yScaleType?: 'linear' | 'log';
}

export function lineChartSVG(opts: LineChartOptions): string {
  const { id, title, series, ticks, n, yFormat, higherIsBetter } = opts;

  const W = 620;
  const marginTop = 14;
  const marginBottom = 30;
  const marginLeft = 64;
  const marginRight = 20;
  const plotW = W - marginLeft - marginRight;
  const plotHeight = 176;
  const H = marginTop + plotHeight + marginBottom;
  const plotX = marginLeft;
  const plotY = marginTop;

  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const dataMax = allY.length ? Math.max(...allY) : 1;
  const isLog = opts.yScaleType === 'log';

  const xScale = (i: number) => (n <= 1 ? plotX + plotW / 2 : plotX + (i / (n - 1)) * plotW);

  let yScale: Scale;
  let yTickValues: number[];
  if (isLog) {
    const domainMin = 1;
    const domainMax = Math.max(dataMax * 1.12, 10);
    const lo = Math.log10(domainMin);
    const hi = Math.log10(domainMax);
    yScale = (v) => plotY + plotHeight - ((Math.log10(Math.max(v, domainMin)) - lo) / (hi - lo)) * plotHeight;
    // "Nice" decade ticks (1×, 3×, 10×, 30×, 100× …) up to the ceiling.
    yTickValues = [];
    for (let base = 1; base <= domainMax; base *= 10) {
      yTickValues.push(base);
      if (base * 3 <= domainMax) yTickValues.push(base * 3);
    }
  } else {
    const domainMin = opts.domainMin ?? 0;
    const domainMax = opts.domainMax ?? Math.max(niceCeil(dataMax), domainMin + 1);
    yScale = linearScale([domainMin, domainMax], [plotY + plotHeight, plotY]);
    const yTickCount = 4;
    yTickValues = Array.from({ length: yTickCount + 1 }, (_, k) => domainMin + ((domainMax - domainMin) / yTickCount) * k);
  }
  const gridSvg = yTickValues
    .map((t) => {
      const y = yScale(t);
      return (
        `<line x1="${fx(plotX)}" y1="${fx(y)}" x2="${fx(plotX + plotW)}" y2="${fx(y)}" stroke="var(--ly-line)" stroke-width="1"/>` +
        `<text x="${fx(plotX - 8)}" y="${fx(y)}" class="ly-axis" text-anchor="end" dominant-baseline="middle">${escapeXml(yFormat(t))}</text>`
      );
    })
    .join('');

  // Anchor the edge ticks inward (first → start, last → end) so a full-width
  // date at x=0 / x=plotW isn't clipped by the viewBox; a single tick (the
  // one-run seed) stays centred under its dot.
  const xTickSvg = ticks
    .map((t, k) => {
      const anchor = ticks.length === 1 ? 'middle' : k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle';
      return `<text x="${fx(xScale(t.i))}" y="${fx(plotY + plotHeight + 16)}" class="ly-axis" text-anchor="${anchor}">${escapeXml(t.label)}</text>`;
    })
    .join('');

  // Native SVG <title> = a no-JS hover tooltip: the run's date, the value, and
  // (where the suite recorded one) the library version. A version differing from
  // the prior run reads as "old → new".
  const pointTitle = (p: TrendPoint, prevVersion?: string): string => {
    const base = `${p.date ? p.date + ' · ' : ''}${yFormat(p.y)}`;
    if (!p.version) return base;
    return prevVersion && prevVersion !== p.version ? `${base} · ${prevVersion} → ${p.version}` : `${base} · v${p.version}`;
  };
  const dotSvg = (p: TrendPoint, k: number, pts: TrendPoint[], color: string, r: number): string => {
    const cx = fx(xScale(p.i));
    const cy = fx(yScale(p.y));
    const prevV = k > 0 ? pts[k - 1].version : undefined;
    const dot = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"><title>${escapeXml(pointTitle(p, prevV))}</title></circle>`;
    // A version change also gets a hollow ring so it's visible without hovering.
    const changed = Boolean(p.version && prevV && p.version !== prevV);
    return changed ? `${dot}<circle cx="${cx}" cy="${cy}" r="${fx(r + 2.6)}" fill="none" stroke="${color}" stroke-width="1.3"/>` : dot;
  };

  const linesSvg = series
    .map((s) => {
      const pts = s.points;
      if (!pts.length) return '';
      const isSelf = Boolean(s.self);
      const glow = isSelf ? ` filter="url(#${id}-glow)"` : '';
      if (pts.length === 1) {
        const p = pts[0];
        return `<circle cx="${fx(xScale(p.i))}" cy="${fx(yScale(p.y))}" r="3.5" fill="${s.color}"${glow}><title>${escapeXml(pointTitle(p))}</title></circle>`;
      }
      const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${fx(xScale(p.i))},${fx(yScale(p.y))}`).join(' ');
      const dots = pts.map((p, k) => dotSvg(p, k, pts, s.color, isSelf ? 2.6 : 2)).join('');
      return (
        `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${isSelf ? 2.5 : 1.5}" ` +
        `stroke-linejoin="round" stroke-linecap="round"${glow}/>${dots}`
      );
    })
    .join('');

  const axis = `<line x1="${fx(plotX)}" y1="${fx(plotY)}" x2="${fx(plotX)}" y2="${fx(plotY + plotHeight)}" stroke="var(--ly-line)" stroke-width="1"/>`;

  const dir = higherIsBetter ? 'higher is better' : 'lower is better';
  const trail = series
    .map((s) => (s.points.length ? `${s.label} ${yFormat(s.points.at(-1)!.y)}` : s.label))
    .join(', ');
  const descText = `${title} — ${dir}. Trend across ${n} benchmark run${n === 1 ? '' : 's'}, oldest to newest; latest values: ${trail}.`;

  return (
    svgOpen(id, W, H, title) +
    `<title id="${id}-t">${escapeXml(title)}</title>` +
    `<desc id="${id}-d">${escapeXml(descText)}</desc>` +
    `<defs>${glowFilter(id)}</defs>` +
    `<style>${chartStyle()}</style>` +
    gridSvg +
    axis +
    xTickSvg +
    linesSvg +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Runtime-dimension composition for /benchmarks — bundles every speed-derived
// chart/table (Parse + Stringify; memory, conformance, and bundle-size have
// no runtime dimension, see queries.ts's loaders) for one runtime family's
// newest document. Kept here, not in the .mdx script, per this file's
// header: the .mdx page stays a thin composition layer, the typed logic
// lives here.
// ---------------------------------------------------------------------------

export interface SpeedFamilySection {
  family: string;
  /** Full `env.runtime` string, for the picker label. */
  runtime: string;
  parseBarSvg: string;
  parseBarLegend: LegendEntry[];
  parseTrendSvg: string;
  parseTrendLegend: LegendEntry[];
  parseTable: string;
  dumpBarSvg: string;
  dumpBarLegend: LegendEntry[];
  dumpTrendSvg: string;
  dumpTrendLegend: LegendEntry[];
  dumpTable: string;
}

/**
 * `idSuffix` disambiguates chart element ids when multiple families render on
 * the page at once (SVG ids must be page-unique); pass '' for the
 * single-family case so ids stay byte-identical to the pre-runtime-dimension
 * markup.
 */
export function speedFamilySection(
  doc: SpeedDoc,
  allRuns: readonly SpeedDoc[],
  curated: readonly string[],
  trendWorkload: string,
  idSuffix: string,
): SpeedFamilySection {
  const runsThis = runsForFamily(allRuns, runtimeFamily(doc.env.runtime));
  const ticks = xTicks(runDates(runsThis));

  const parseWl = pickWorkloads(doc.operations.parse, curated);
  const parseOrder = presentIn(LIBRARY_ORDER, parseWl);
  const parseTrendOrder = presentIn(LIBRARY_ORDER, pickWorkloads(doc.operations.parse, [trendWorkload]));
  const parseTrendSeries = speedTrend(runsThis, 'parse', trendWorkload, parseTrendOrder);

  const dumpWl = pickWorkloads(doc.operations.stringify, curated);
  const dumpOrder = presentIn(LIBRARY_ORDER, dumpWl);
  const dumpTrendOrder = presentIn(LIBRARY_ORDER, pickWorkloads(doc.operations.stringify, [trendWorkload]));
  const dumpTrendSeries = speedTrend(runsThis, 'stringify', trendWorkload, dumpTrendOrder);

  return {
    family: runtimeFamily(doc.env.runtime),
    runtime: doc.env.runtime,
    parseBarSvg: groupedBarSVG({
      id: `bar-parse-speed${idSuffix}`,
      title: 'Parse time by workload (relative to fastest, per row)',
      series: seriesFor(doc.libraries, parseOrder),
      groups: speedGroups(parseWl),
      unit: 'ns',
      lowerIsBetter: true,
      labelStyle: 'ratio-to-best',
    }),
    parseBarLegend: legendFor(doc.libraries, parseOrder),
    parseTrendSvg: lineChartSVG({
      id: `trend-parse-speed${idSuffix}`,
      title: `Parse time vs fastest over time — ${trendWorkload}`,
      series: parseTrendSeries,
      ticks,
      n: runsThis.length,
      yFormat: formatRatio,
      higherIsBetter: false,
      yScaleType: 'log',
    }),
    parseTrendLegend: trendLegend(parseTrendSeries),
    parseTable: speedBreakdownHtml(doc.operations.parse, doc.libraries, presentIn(LIBRARY_ORDER, doc.operations.parse)),
    dumpBarSvg: groupedBarSVG({
      id: `bar-dump-speed${idSuffix}`,
      title: 'Stringify time by workload (relative to fastest, per row)',
      series: seriesFor(doc.libraries, dumpOrder),
      groups: speedGroups(dumpWl),
      unit: 'ns',
      lowerIsBetter: true,
      labelStyle: 'ratio-to-best',
    }),
    dumpBarLegend: legendFor(doc.libraries, dumpOrder),
    dumpTrendSvg: lineChartSVG({
      id: `trend-dump-speed${idSuffix}`,
      title: `Stringify time vs fastest over time — ${trendWorkload}`,
      series: dumpTrendSeries,
      ticks,
      n: runsThis.length,
      yFormat: formatRatio,
      higherIsBetter: false,
      yScaleType: 'log',
    }),
    dumpTrendLegend: trendLegend(dumpTrendSeries),
    dumpTable: speedBreakdownHtml(doc.operations.stringify, doc.libraries, presentIn(LIBRARY_ORDER, doc.operations.stringify)),
  };
}
