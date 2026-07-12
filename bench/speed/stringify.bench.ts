/**
 * Stringify-speed benchmark (mitata). Each candidate serializes the identical
 * in-memory value (pre-parsed once from the fixture). Output format differs
 * per candidate (JSON vs YAML text) — we're measuring serialization speed of
 * equivalent data. One group per dataset.
 *
 *   node --expose-gc --import tsx bench/speed/stringify.bench.ts
 */

import { bench, group, run, do_not_optimize } from "mitata";
import { candidates } from "../candidates.ts";
import { datasets, loadFixture } from "../fixtures/datasets.ts";

for (const ds of datasets) {
  const value = JSON.parse(loadFixture(ds.name));
  group(`stringify · ${ds.name}`, () => {
    for (const c of candidates) {
      bench(c.name, () => do_not_optimize(c.stringify(value)));
    }
  });
}

await run();
