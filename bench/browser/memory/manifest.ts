/**
 * The fixed fixture set for the memory-ratios harness: the yaml-plain trio +
 * yaml-rich set the Node peak-memory suite (bench/memory/) also uses.
 * Deliberately narrower than that suite's full dataset list — no `json`
 * category, no 10 MB `xlarge-records` — because neither applies here:
 * JSON.parse can't parse either YAML category at all (candidateApplies in
 * ../../candidates.ts), and the browser fixture budget
 * (bench/browser/manifest.ts's BROWSER_FIXTURE_BUDGET_BYTES) caps included
 * fixtures at 1.2 MB regardless.
 */

import { datasetByName, fixtureExt, type Category } from "../../fixtures/datasets.ts";

// Ordered smallest-tier-first ACROSS categories (not grouped by category then
// size) so a fresh page never measures a small fixture immediately after a
// large one — a large fixture's retained-then-dropped batch (tens of MB) can
// leave GC sweeping/finalization work in flight for a moment even after
// gc() returns (see pageHarness.ts's __memReadHeap comment), which is enough
// to swing a much smaller fixture's net delta straight through zero.
export const MEMORY_RATIO_FIXTURE_NAMES = [
  "yaml-plain-small-records",
  "yaml-rich-small",
  "yaml-plain-medium-records",
  "yaml-rich-medium",
  "yaml-plain-large-records",
  "yaml-rich-large",
] as const;

/** Logged (not measured) for transparency — mirrors the speed harness's manifest.ts `skipped` list. */
export const SKIPPED_FIXTURES: ReadonlyArray<{ name: string; reason: string }> = [
  {
    name: "xlarge-records",
    reason: "10 MB, JSON-only category — no YAML candidate parses it, and it's over the 1.2 MB browser fixture budget anyway",
  },
];

export interface MemoryFixture {
  name: string;
  category: Category;
  url: string;
}

export function memoryRatioFixtures(): MemoryFixture[] {
  return MEMORY_RATIO_FIXTURE_NAMES.map((name) => {
    const ds = datasetByName(name);
    return { name: ds.name, category: ds.category, url: `/fixtures/${ds.name}${fixtureExt(ds.category)}` };
  });
}
