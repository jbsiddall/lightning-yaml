/**
 * Stringify-speed benchmark (mitata). Each candidate serializes the identical
 * in-memory value (loaded once from the fixture — JSON.parse for JSON fixtures,
 * the oracle for YAML fixtures). Output format differs per candidate (JSON vs
 * YAML text, and for rich data `!!binary` vs a number array) — we're measuring
 * serialization speed of equivalent data. One group per dataset.
 *
 *   node --expose-gc --import tsx bench/speed/stringify.bench.ts
 *
 * JSON is skipped for rich YAML (it can't represent `!!binary`/shared refs);
 * lightning-yaml's unimplemented stub is skipped everywhere.
 */

import { bench, group, run, do_not_optimize } from "mitata";
import {
  selectCandidates,
  scopeFromEnv,
  candidateAppliesTo,
  candidateSupports,
  candidateHandles,
} from "../candidates.ts";
import { datasets, loadFixtureValue } from "../fixtures/datasets.ts";

const candidates = selectCandidates(scopeFromEnv());

for (const ds of datasets) {
  const applicable = candidates.filter(
    (c) => candidateAppliesTo(c, ds, "stringify") && candidateSupports(c, "stringify"),
  );
  if (applicable.length === 0) continue;
  const value = loadFixtureValue(ds);
  // Skip candidates that can't serialize this specific value without throwing.
  const cands = applicable.filter((c) => candidateHandles(c, "stringify", value));
  if (cands.length === 0) continue;
  group(`stringify · ${ds.name}`, () => {
    for (const c of cands) {
      // `candidateSupports(c, "stringify")` above guarantees `c.stringify` here;
      // candidates without a dumper were already filtered out.
      const stringify = c.stringify!;
      bench(c.name, () => do_not_optimize(stringify(value)));
    }
  });
}

// BENCH_FORMAT=markdown yields README-ready tables; default is the pretty TTY view.
await run(process.env.BENCH_FORMAT ? { format: process.env.BENCH_FORMAT as "markdown" } : undefined);
