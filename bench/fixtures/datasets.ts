/**
 * Dataset definitions + path/loader helpers. The actual fixture files are
 * generated (and gitignored); run `pnpm gen:fixtures` to (re)create them.
 * Because the generator is seeded, the files are byte-for-byte reproducible.
 *
 * There are three categories of fixture, split by the syntax they exercise:
 *
 *   - "json"       — plain JSON (also a valid flow-style YAML 1.2 document), so
 *                    the identical bytes feed JSON.parse and both YAML parsers.
 *                    Written as `.json`.
 *   - "yaml-plain" — block-style YAML whose data is still pure JSON (maps, seqs,
 *                    strings, numbers, bools, null) with NO tags or anchors. It's
 *                    "just JSON structures in YAML syntax". JSON.parse cannot read
 *                    block YAML, so JSON is excluded from parsing these — but the
 *                    parsed value is JSON-compatible, so JSON.stringify still
 *                    serves as a stringify baseline. Written as `.yaml`.
 *   - "yaml-rich"  — block-style YAML that uses YAML-only syntax: the `!!binary`
 *                    tag (base64 blobs) and `&anchor`/`*alias` graph references
 *                    (shared object references). JSON can neither parse this text
 *                    nor faithfully represent the value (Uint8Array, shared
 *                    refs), so JSON is excluded entirely. Written as `.yaml`.
 *
 * See `candidateApplies` in ../candidates.ts for how these categories decide
 * which candidates run for parse vs. stringify.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { oracleParse } from "../oracle.ts";

/** How the data is shaped (drives the fixture generator). */
export type Shape = "records" | "nested" | "strings" | "numbers" | "rich";

/** Which syntax family a fixture exercises (see module doc). */
export type Category = "json" | "yaml-plain" | "yaml-rich";

export interface DatasetDef {
  /** File basename (without extension) and display name. */
  name: string;
  category: Category;
  shape: Shape;
  /** Approximate target size of the serialized fixture, in bytes. */
  bytes: number;
  /** PRNG seed — distinct per dataset for variety, fixed for reproducibility. */
  seed: number;
}

export const datasets: DatasetDef[] = [
  // JSON — the existing baseline matrix (size × shape). Same bytes for every
  // parser; JSON.parse applies here.
  { name: "small-records", category: "json", shape: "records", bytes: 1_000, seed: 101 },
  { name: "medium-records", category: "json", shape: "records", bytes: 100_000, seed: 102 },
  { name: "large-records", category: "json", shape: "records", bytes: 1_000_000, seed: 103 },
  { name: "xlarge-records", category: "json", shape: "records", bytes: 10_000_000, seed: 104 },
  { name: "medium-nested", category: "json", shape: "nested", bytes: 100_000, seed: 105 },
  { name: "large-nested", category: "json", shape: "nested", bytes: 1_000_000, seed: 106 },

  // YAML, plain — the same JSON-shaped data, emitted as block YAML. Exercises
  // the YAML parsers on real block syntax without any tags/anchors.
  { name: "yaml-plain-small-records", category: "yaml-plain", shape: "records", bytes: 1_000, seed: 201 },
  { name: "yaml-plain-medium-records", category: "yaml-plain", shape: "records", bytes: 100_000, seed: 202 },
  { name: "yaml-plain-large-records", category: "yaml-plain", shape: "records", bytes: 1_000_000, seed: 203 },
  { name: "yaml-plain-medium-nested", category: "yaml-plain", shape: "nested", bytes: 100_000, seed: 204 },

  // YAML, rich — block YAML using YAML-only syntax: `!!binary` blobs and
  // `&anchor`/`*alias` shared references. Kept to <=1 MB to bound the (slow)
  // competition run.
  { name: "yaml-rich-small", category: "yaml-rich", shape: "rich", bytes: 1_000, seed: 301 },
  { name: "yaml-rich-medium", category: "yaml-rich", shape: "rich", bytes: 100_000, seed: 302 },
  { name: "yaml-rich-large", category: "yaml-rich", shape: "rich", bytes: 1_000_000, seed: 303 },
];

const here = dirname(fileURLToPath(import.meta.url));
export const dataDir = join(here, "data");

/** File extension for a category: JSON → `.json`, both YAML flavours → `.yaml`. */
export function fixtureExt(category: Category): ".json" | ".yaml" {
  return category === "json" ? ".json" : ".yaml";
}

export function fixturePath(ds: DatasetDef): string {
  return join(dataDir, `${ds.name}${fixtureExt(ds.category)}`);
}

export function datasetByName(name: string): DatasetDef {
  const ds = datasets.find((d) => d.name === name);
  if (!ds) throw new Error(`Unknown dataset: ${name}`);
  return ds;
}

/** Raw fixture text (the bytes on disk) — what parse benchmarks consume. */
export function loadFixtureText(ds: DatasetDef): string {
  return readFileSync(fixturePath(ds), "utf8");
}

/**
 * The in-memory value a fixture represents — what stringify benchmarks consume.
 * JSON fixtures parse with JSON.parse; YAML fixtures parse with the oracle so
 * YAML-only values (Uint8Array from `!!binary`, shared refs from anchors) are
 * reconstructed faithfully.
 */
export function loadFixtureValue(ds: DatasetDef): unknown {
  const text = loadFixtureText(ds);
  return ds.category === "json" ? JSON.parse(text) : oracleParse(text);
}
