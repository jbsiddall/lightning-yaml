/**
 * Generate the JSON fixtures into `bench/fixtures/data/`.
 *
 * For each dataset we build one representative element, measure its serialized
 * size, and emit however many copies are needed to land near the target byte
 * count. Deterministic given the seed, so re-running produces identical files.
 *
 *   pnpm gen:fixtures
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { makeRng, type Rng } from "../util/prng.ts";
import { formatBytes } from "../util/format.ts";
import { datasets, dataDir, fixturePath, type Shape } from "./datasets.ts";

function makeRecord(rng: Rng, i: number) {
  return {
    id: i,
    uuid: `${rng.int(0, 0xffff).toString(16)}-${rng.int(0, 0xffffff).toString(16)}`,
    name: rng.words(rng.int(2, 4)),
    active: rng.bool(),
    score: Number(rng.float(0, 100).toFixed(4)),
    tags: Array.from({ length: rng.int(0, 5) }, () => rng.words(1)),
    created: `2026-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
    meta: { views: rng.int(0, 1_000_000), ratio: rng.float(0, 1) },
  };
}

function makeTree(rng: Rng, depth: number): unknown {
  if (depth <= 0) {
    return rng.pick([rng.int(0, 100000), rng.words(2), rng.bool(), rng.float(0, 1)]);
  }
  const node: Record<string, unknown> = {};
  const branches = rng.int(2, 4);
  for (let i = 0; i < branches; i++) node[`node_${i}`] = makeTree(rng, depth - 1);
  return node;
}

function makeStringRecord(rng: Rng) {
  return {
    title: rng.words(rng.int(4, 8)),
    body: rng.chars(rng.int(120, 400)),
    quoted: `line1\nline2\t"${rng.words(2)}"`,
  };
}

function makeNumberRecord(rng: Rng) {
  return {
    ints: Array.from({ length: 8 }, () => rng.int(-1_000_000, 1_000_000)),
    floats: Array.from({ length: 8 }, () => rng.float(-1e6, 1e6)),
  };
}

/** Repeat `make` until the serialized array is ~targetBytes. */
function fill(targetBytes: number, make: (i: number) => unknown): unknown[] {
  const sample = make(0);
  const perElement = JSON.stringify(sample).length + 1; // +1 for the comma
  const count = Math.max(1, Math.floor(targetBytes / perElement));
  const out: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = make(i);
  return out;
}

function build(shape: Shape, rng: Rng, targetBytes: number): unknown {
  switch (shape) {
    case "records":
      return fill(targetBytes, (i) => makeRecord(rng, i));
    case "nested":
      return fill(targetBytes, () => makeTree(rng, 6));
    case "strings":
      return fill(targetBytes, () => makeStringRecord(rng));
    case "numbers":
      return fill(targetBytes, () => makeNumberRecord(rng));
  }
}

mkdirSync(dataDir, { recursive: true });

for (const ds of datasets) {
  const rng = makeRng(ds.seed);
  const value = build(ds.shape, rng, ds.bytes);
  const json = JSON.stringify(value);
  writeFileSync(fixturePath(ds.name), json);
  console.log(`  ${ds.name.padEnd(16)} ${formatBytes(json.length).padStart(10)}  (target ${formatBytes(ds.bytes)})`);
}

console.log(`\nWrote ${datasets.length} fixtures to ${dataDir}`);
