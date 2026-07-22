/**
 * Reduce a raw mitata `run()` result into the `{workload, values}` rows the
 * speed-doc emitters write under `operations.parse` / `operations.stringify`.
 * Pulled out of bench/speed/emit.ts so bench/browser/entry.ts (running
 * in-page, no filesystem) can produce byte-identical stats math instead of
 * re-deriving it — the two emitters differ only in HOW they get fixtures and
 * environment metadata, not in how mitata's numbers become a doc.
 *
 * No Node-builtin imports here on purpose: this module is bundled into the
 * browser harness as-is.
 */

import type { Op } from "../candidates.ts";

// mitata 1.0.34's runtime `run()` result carries `layout` (group index ->
// label) and each benchmark's `group` index into it, neither of which is
// declared in the package's shipped .d.mts — verified by probing the
// installed package's actual return value. This local type documents the
// real (larger) contract this file depends on; a cast at the `run()` call
// site is therefore deliberate, not a type-safety hole around unverified data.
export interface SpeedStat {
  avg: number;
  min: number;
  p75: number;
  p99: number;
  max: number;
}
export interface MitataRun {
  stats?: SpeedStat;
  error?: unknown;
}
export interface MitataBenchmark {
  alias: string;
  group: number;
  runs: MitataRun[];
}
export interface MitataLayoutEntry {
  name: string | null;
}
export interface MitataTrial {
  layout: MitataLayoutEntry[];
  benchmarks: MitataBenchmark[];
}

export interface WorkloadRow {
  workload: string;
  values: Record<string, SpeedStat>;
}

/**
 * Bucket every benchmark's first run by op + workload, keyed off the
 * `"<op> · <workload>"` group label every speed bench registers (see
 * bench/speed/parse.bench.ts / stringify.bench.ts / bench/browser/entry.ts).
 * A benchmark with no stats (error, or — defensively — a missing run) is
 * skipped; with `run({ throw: true })` upstream this should never trigger.
 */
export function reduceMitataTrial(trial: MitataTrial): Record<Op, Map<string, Record<string, SpeedStat>>> {
  const values: Record<Op, Map<string, Record<string, SpeedStat>>> = {
    parse: new Map(),
    stringify: new Map(),
  };

  for (const b of trial.benchmarks) {
    const label = trial.layout[b.group]?.name;
    if (!label) continue;
    const sep = label.indexOf(" · ");
    if (sep === -1) continue;
    const op = label.slice(0, sep) as Op;
    const workload = label.slice(sep + 3);
    const target = values[op];
    if (!target) continue;
    const run0 = b.runs[0];
    if (!run0 || run0.error || !run0.stats) continue; // defensive; see module doc.
    const s = run0.stats;
    const row = target.get(workload) ?? {};
    row[b.alias] = {
      avg: Math.round(s.avg),
      min: Math.round(s.min),
      p75: Math.round(s.p75),
      p99: Math.round(s.p99),
      max: Math.round(s.max),
    };
    target.set(workload, row);
  }

  return values;
}

/** Rows for one op, in `orderedNames` order (the canonical dataset order), skipping empty ones. */
export function rowsInOrder(
  values: Map<string, Record<string, SpeedStat>>,
  orderedNames: readonly string[],
): WorkloadRow[] {
  const rows: WorkloadRow[] = [];
  for (const name of orderedNames) {
    const v = values.get(name);
    if (v && Object.keys(v).length > 0) rows.push({ workload: name, values: v });
  }
  return rows;
}
