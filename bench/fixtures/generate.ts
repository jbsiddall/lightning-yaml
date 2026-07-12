/**
 * Generate the benchmark fixtures into `bench/fixtures/data/`.
 *
 * For each dataset we build one representative element, measure its serialized
 * size, and emit however many copies are needed to land near the target byte
 * count. Deterministic given the seed, so re-running produces identical files.
 *
 * Three categories are emitted (see ./datasets.ts):
 *   - "json"       → JSON.stringify           → `.json`
 *   - "yaml-plain" → yaml.stringify (block)   → `.yaml`   (no tags/anchors)
 *   - "yaml-rich"  → yaml.stringify, 1.1 schema → `.yaml` (`!!binary` + anchors)
 *
 *   pnpm gen:fixtures            # (re)write every fixture
 *
 * `generateAll`/`ensureFixtures` are also imported by the vitest global setup so
 * `pnpm test` works on a fresh checkout without a manual generate step.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";
import { makeRng, type Rng } from "../util/prng.ts";
import { formatBytes } from "../util/format.ts";
import { datasets, dataDir, fixturePath, type DatasetDef } from "./datasets.ts";

// ---------------------------------------------------------------------------
// Element builders (one per shape)
// ---------------------------------------------------------------------------

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

/** `len` pseudo-random bytes as a Uint8Array → serialized as a `!!binary` blob. */
function makeBytes(rng: Rng, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = rng.int(0, 255);
  return out;
}

/**
 * A small pool of shared "config" objects. Rich elements reference these by
 * identity, so the serializer emits one `&anchor` per pool entry and an `*alias`
 * at every reuse — exercising the anchor/alias machinery at scale.
 */
function makePool(rng: Rng): unknown[] {
  const regions = ["us-east", "us-west", "eu-central", "ap-south", "sa-east"];
  return Array.from({ length: 5 }, () => ({
    region: rng.pick(regions),
    tier: rng.int(1, 4),
    endpoints: Array.from({ length: rng.int(1, 3) }, () => `${rng.words(1)}.svc.local`),
    limits: { rps: rng.int(10, 5000), burst: rng.int(1, 100) },
  }));
}

/** One rich record: a shared `cfg` reference (→ alias) + a `!!binary` payload. */
function makeRichElement(rng: Rng, pool: unknown[], i: number) {
  return {
    id: i,
    cfg: rng.pick(pool), // shared reference → &anchor / *alias
    label: rng.words(rng.int(2, 4)),
    payload: makeBytes(rng, rng.int(12, 48)), // Uint8Array → !!binary
    stats: {
      active: rng.bool(),
      score: Number(rng.float(0, 1).toFixed(3)),
      hits: rng.int(0, 9999),
    },
  };
}

// ---------------------------------------------------------------------------
// Serialization + sizing
// ---------------------------------------------------------------------------

/** Serialize a value the way the dataset's category prescribes. */
function serialize(ds: DatasetDef, value: unknown): string {
  switch (ds.category) {
    case "json":
      return JSON.stringify(value);
    case "yaml-plain":
      return yamlStringify(value);
    case "yaml-rich":
      // The 1.1 schema is what emits `!!binary` for Uint8Array; anchors for
      // duplicate object references are on by default.
      return yamlStringify(value, { schema: "yaml-1.1", aliasDuplicateObjects: true });
  }
}

/**
 * Repeat `make` until the JSON-serialized array is ~targetBytes. Preserved
 * verbatim (JSON sizing, single-element sample) so the existing JSON fixtures
 * stay byte-for-byte identical across regenerations.
 */
function fill(targetBytes: number, make: (i: number) => unknown): unknown[] {
  const sample = make(0);
  const perElement = JSON.stringify(sample).length + 1; // +1 for the comma
  const count = Math.max(1, Math.floor(targetBytes / perElement));
  const out: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = make(i);
  return out;
}

/**
 * Like `fill`, but measures with the dataset's actual (YAML) serializer over a
 * small batch — so block YAML (more verbose than JSON) and rich fixtures (whose
 * anchors amortize over the array) still land near their byte target.
 */
function fillMeasured(ds: DatasetDef, make: (i: number) => unknown): unknown[] {
  const batch = 16;
  const sample = Array.from({ length: batch }, (_, i) => make(i));
  const perElement = Math.max(1, serialize(ds, sample).length / batch);
  const count = Math.max(1, Math.floor(ds.bytes / perElement));
  const out: unknown[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = make(i);
  return out;
}

/** Build the in-memory value for a dataset from its shape. */
function buildValue(ds: DatasetDef, rng: Rng): unknown {
  const measured = ds.category !== "json";
  const repeat = (make: (i: number) => unknown) =>
    measured ? fillMeasured(ds, make) : fill(ds.bytes, make);

  switch (ds.shape) {
    case "records":
      return repeat((i) => makeRecord(rng, i));
    case "nested":
      return repeat(() => makeTree(rng, 6));
    case "strings":
      return repeat(() => makeStringRecord(rng));
    case "numbers":
      return repeat(() => makeNumberRecord(rng));
    case "rich": {
      const pool = makePool(rng);
      return fillMeasured(ds, (i) => makeRichElement(rng, pool, i));
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Skip datasets whose fixture file already exists (used by the test setup). */
  onlyMissing?: boolean;
  /** Suppress per-file logging. */
  quiet?: boolean;
}

/** (Re)generate the fixtures on disk. */
export function generateAll(opts: GenerateOptions = {}): void {
  const { onlyMissing = false, quiet = false } = opts;
  mkdirSync(dataDir, { recursive: true });

  let written = 0;
  for (const ds of datasets) {
    const path = fixturePath(ds);
    if (onlyMissing && existsSync(path)) continue;

    const rng = makeRng(ds.seed);
    const value = buildValue(ds, rng);
    const text = serialize(ds, value);
    writeFileSync(path, text);
    written++;
    if (!quiet) {
      console.log(
        `  ${ds.name.padEnd(26)} ${formatBytes(text.length).padStart(10)}  ` +
          `(${ds.category}, target ${formatBytes(ds.bytes)})`,
      );
    }
  }

  if (!quiet) {
    const skipped = datasets.length - written;
    console.log(
      `\nWrote ${written} fixture${written === 1 ? "" : "s"} to ${dataDir}` +
        (skipped ? ` (${skipped} already present)` : ""),
    );
  }
}

/**
 * Ensure every fixture exists, generating only the missing ones. Existing files
 * are left as-is — this does NOT refresh fixtures after a generator/dataset
 * change, so run `pnpm gen:fixtures` (full regenerate) when you edit those.
 */
export function ensureFixtures(): void {
  generateAll({ onlyMissing: true, quiet: true });
}

// Run as a CLI (`pnpm gen:fixtures`) — regenerate everything.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  generateAll();
}
