/**
 * Which candidates the memory-ratios harness measures, and where each one's
 * isolated browser entry lives (see entries/*.ts). Node-side only — never
 * bundled into a page (that's exactly what entries/*.ts exist to avoid; see
 * their header comments) — so this can freely import bench/candidates.ts for
 * metadata (labels, versions, applicability) without dragging any library
 * code into the browser bundle.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidates, candidateApplies, candidateSupports, libraryMeta, type LibraryMeta } from "../../candidates.ts";
import { memoryRatioFixtures } from "./manifest.ts";

const ENTRIES_DIR = join(dirname(fileURLToPath(import.meta.url)), "entries");

export interface MemoryRatioLibrary {
  id: string;
  entryPoint: string;
  meta: LibraryMeta;
}

/**
 * Every candidate that can PARSE every fixture category this harness covers
 * (yaml-plain, yaml-rich) — i.e. every `kind: "yaml"` candidate not narrowed
 * away from parse or those categories. Excludes JSON (can't parse block YAML
 * at all) and js-yaml-tuned (stringify-only) automatically, via the same
 * `candidateApplies`/`candidateSupports` gates the Node and speed harnesses
 * use — so a new competitor registered in candidates.ts is picked up here
 * too, with no list to remember to update, PROVIDED its `entries/<name>.ts`
 * file exists (that one step is manual: an isolated single-library bundle
 * needs real per-library import code, which can't be derived generically).
 */
export function memoryRatioLibraries(): MemoryRatioLibrary[] {
  const fixtures = memoryRatioFixtures();
  return candidates
    .filter((c) => candidateSupports(c, "parse") && fixtures.every((f) => candidateApplies(c, f.category, "parse")))
    .map((c) => ({ id: c.name, entryPoint: join(ENTRIES_DIR, `${c.name}.ts`), meta: libraryMeta(c) }));
}
