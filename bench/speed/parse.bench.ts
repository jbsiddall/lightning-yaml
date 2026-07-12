/**
 * Parse-speed benchmark (mitata). Feeds each candidate the identical fixture
 * text and measures throughput. One group per dataset.
 *
 *   node --expose-gc --import tsx bench/speed/parse.bench.ts
 *
 * `--expose-gc` lets mitata report GC/heap columns alongside timing.
 */

import { bench, group, run, do_not_optimize } from "mitata";
import { selectCandidates, scopeFromEnv } from "../candidates.ts";
import { datasets, loadFixture } from "../fixtures/datasets.ts";

const candidates = selectCandidates(scopeFromEnv());

for (const ds of datasets) {
  const text = loadFixture(ds.name);
  group(`parse · ${ds.name}`, () => {
    for (const c of candidates) {
      bench(c.name, () => do_not_optimize(c.parse(text)));
    }
  });
}

// BENCH_FORMAT=markdown yields README-ready tables; default is the pretty TTY view.
await run(process.env.BENCH_FORMAT ? { format: process.env.BENCH_FORMAT as "markdown" } : undefined);
