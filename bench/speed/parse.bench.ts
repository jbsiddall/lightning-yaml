/**
 * Parse-speed benchmark (mitata). Feeds each candidate the identical fixture
 * text and measures throughput. One group per dataset.
 *
 *   node --expose-gc --import tsx bench/speed/parse.bench.ts
 *
 * `--expose-gc` lets mitata report GC/heap columns alongside timing.
 *
 * Candidates that don't apply to a dataset (e.g. JSON.parse can't read block
 * YAML) or aren't implemented yet (lightning-yaml's stub) are skipped, so YAML
 * fixtures benchmark only the parsers that can actually read them.
 */

import { bench, group, run, do_not_optimize } from "mitata";
import { selectCandidates, scopeFromEnv, candidateAppliesTo, candidateSupports } from "../candidates.ts";
import { datasets, loadFixtureText } from "../fixtures/datasets.ts";

const candidates = selectCandidates(scopeFromEnv());

for (const ds of datasets) {
  const cands = candidates.filter(
    (c) => candidateAppliesTo(c, ds, "parse") && candidateSupports(c, "parse"),
  );
  if (cands.length === 0) continue;
  const text = loadFixtureText(ds);
  group(`parse · ${ds.name}`, () => {
    for (const c of cands) {
      bench(c.name, () => do_not_optimize(c.parse(text)));
    }
  });
}

// BENCH_FORMAT=markdown yields README-ready tables; default is the pretty TTY view.
await run(process.env.BENCH_FORMAT ? { format: process.env.BENCH_FORMAT as "markdown" } : undefined);
