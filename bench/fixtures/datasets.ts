/**
 * Dataset definitions + path helpers. The actual `.json` files are generated
 * (and gitignored); run `pnpm gen:fixtures` to (re)create them. Because the
 * generator is seeded, the files are byte-for-byte reproducible.
 *
 * Every fixture is plain JSON — which is also a valid (flow-style) YAML 1.2
 * document — so the identical bytes feed JSON.parse and both YAML parsers.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type Shape = "records" | "nested" | "strings" | "numbers";

export interface DatasetDef {
  /** File basename (without extension) and display name. */
  name: string;
  shape: Shape;
  /** Approximate target size of the serialized JSON, in bytes. */
  bytes: number;
  /** PRNG seed — distinct per dataset for variety, fixed for reproducibility. */
  seed: number;
}

export const datasets: DatasetDef[] = [
  { name: "small-records", shape: "records", bytes: 1_000, seed: 101 },
  { name: "medium-records", shape: "records", bytes: 100_000, seed: 102 },
  { name: "large-records", shape: "records", bytes: 1_000_000, seed: 103 },
  { name: "xlarge-records", shape: "records", bytes: 10_000_000, seed: 104 },
  { name: "medium-nested", shape: "nested", bytes: 100_000, seed: 105 },
  { name: "large-nested", shape: "nested", bytes: 1_000_000, seed: 106 },
];

const here = dirname(fileURLToPath(import.meta.url));
export const dataDir = join(here, "data");

export function fixturePath(name: string): string {
  return join(dataDir, `${name}.json`);
}

export function loadFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}
