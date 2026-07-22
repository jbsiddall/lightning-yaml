/**
 * Derives the browser-safe fixture manifest from bench/fixtures/datasets.ts
 * (the single source of truth for dataset definitions) — Node-side only, so
 * it can freely import datasets.ts (which touches node:fs/node:path/node:url
 * at module scope) without breaking bench/browser/entry.ts's bundle. The
 * manifest this produces is plain data ({name, category, ext}[]), safe to
 * serialize into generated/manifest.json for the browser bundle to import.
 */

import { datasets, fixtureExt, type Category } from "../fixtures/datasets.ts";

/**
 * Fixture text/time budget for the in-browser run. `xlarge-records` (10 MB)
 * is the only dataset over this line — everything else tops out at ~1.2 MB
 * (large-nested.json generates to ~1.19 MB against its 1 MB target). Filtered
 * on the dataset's declared target `bytes`, not the realized file size, so
 * this doesn't need a filesystem stat.
 */
export const BROWSER_FIXTURE_BUDGET_BYTES = 1_200_000;

export interface ManifestEntry {
  name: string;
  category: Category;
  ext: ".json" | ".yaml";
}

export interface BrowserManifest {
  included: ManifestEntry[];
  skipped: { name: string; bytes: number }[];
}

export function buildManifest(): BrowserManifest {
  const included: ManifestEntry[] = [];
  const skipped: { name: string; bytes: number }[] = [];
  for (const ds of datasets) {
    if (ds.bytes > BROWSER_FIXTURE_BUDGET_BYTES) {
      skipped.push({ name: ds.name, bytes: ds.bytes });
      continue;
    }
    included.push({ name: ds.name, category: ds.category, ext: fixtureExt(ds.category) });
  }
  return { included, skipped };
}
