/**
 * Parse-speed benchmark (mitata). Feeds each candidate the identical fixture
 * text and measures throughput. One group per dataset.
 *
 *   node --expose-gc --import tsx bench/speed/parse.bench.ts
 *
 * `--expose-gc` lets mitata report GC/heap columns alongside timing.
 */

import { bench, group, run, do_not_optimize } from "mitata";
import { candidates } from "../candidates.ts";
import { datasets, loadFixture } from "../fixtures/datasets.ts";

for (const ds of datasets) {
  const text = loadFixture(ds.name);
  group(`parse · ${ds.name}`, () => {
    for (const c of candidates) {
      bench(c.name, () => do_not_optimize(c.parse(text)));
    }
  });
}

await run();
