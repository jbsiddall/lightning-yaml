/**
 * Speed-benchmark emitter. Runs parse AND stringify across the full dataset
 * matrix in ONE mitata `run()` (so both ops share a single context/env), then
 * writes results/benchmarks/speed.yaml — a single YAML doc (no leading `---`)
 * that `bench/report.ts` (or CI) appends to the append-only `benchmark-data`
 * orphan branch the docs site reads.
 *
 *   node --expose-gc --import tsx bench/speed/emit.ts
 *
 * `--expose-gc` lets mitata report GC/heap stats alongside timing.
 *
 * Env:
 *   BENCH_SCOPE   all | competition | ours  (default: all — see selectCandidates)
 *   BENCH_SOURCE  provenance string for the doc's `source` field (default: git sha)
 *
 * Candidate selection mirrors bench/speed/parse.bench.ts and stringify.bench.ts
 * (kept as the interactive/markdown benches for local exploration): a
 * candidate that doesn't apply to a dataset, isn't implemented yet, or can't
 * handle this specific fixture is skipped rather than benchmarked into an
 * error row.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { bench, group, run, do_not_optimize } from "mitata";
import { stringify as toYaml } from "yaml";
import { SpeedDocSchema } from "../schemas.ts";
import {
  selectCandidates,
  scopeFromEnv,
  candidateAppliesTo,
  candidateSupports,
  candidateHandles,
  libraryMeta,
  scopeLabel,
} from "../candidates.ts";
import { datasets, loadFixtureText, loadFixtureValue } from "../fixtures/datasets.ts";
import { reduceMitataTrial, rowsInOrder, type MitataTrial } from "../util/mitataTrial.ts";

const OUT = fileURLToPath(new URL("../../results/benchmarks/speed.yaml", import.meta.url));

const OPS = ["parse", "stringify"] as const;
type Op = (typeof OPS)[number];

const scope = scopeFromEnv();
const candidates = selectCandidates(scope);

// Names of candidates that end up with at least one registered bench, in
// `candidates` order — becomes the doc's `libraries` list.
const used = new Set<string>();

for (const ds of datasets) {
  for (const op of OPS) {
    const applicable = candidates.filter(
      (c) => candidateAppliesTo(c, ds, op) && candidateSupports(c, op),
    );
    if (applicable.length === 0) continue;
    const input: string | unknown = op === "parse" ? loadFixtureText(ds) : loadFixtureValue(ds);
    // Skip a partial parser on input it can't yet handle instead of
    // benchmarking it into an error row (mitata can't benchmark a throw).
    const cands = applicable.filter((c) => candidateHandles(c, op, input, ds.category));
    if (cands.length === 0) continue;
    group(`${op} · ${ds.name}`, () => {
      for (const c of cands) {
        used.add(c.name);
        if (op === "parse") {
          bench(c.name, () => do_not_optimize(c.parse(input as string, ds.category)));
        } else {
          // candidateSupports(c, "stringify") above guarantees c.stringify here.
          const stringify = c.stringify!;
          bench(c.name, () => do_not_optimize(stringify(input)));
        }
      }
    });
  }
}

// mitata 1.0.34's runtime `run()` result carries `layout` (group index ->
// label), each benchmark's `group` index into it, AND `context` (cpu/runtime/
// arch), none of which are declared in the package's shipped .d.mts —
// verified by probing the installed package's actual return value. The
// layout/benchmarks shape is documented in bench/util/mitataTrial.ts (shared
// with the browser emitter); `context` is Node-emitter-only, so it stays
// local here as an extension. The cast below is therefore deliberate, not a
// type-safety hole around unverified data.
interface MitataContext {
  cpu: { freq: number; name: string | null };
  runtime: string | null;
  version?: string;
  arch: string | null;
}
interface MitataTrialWithContext extends MitataTrial {
  context: MitataContext;
}

// `throw: true` means any bench that errors rethrows immediately rather than
// being captured per-run — the candidateHandles() filtering above means this
// should never trigger; if it somehow does, failing loudly beats silently
// publishing a bogus/missing row.
const trial = (await run({ format: "quiet", throw: true })) as unknown as MitataTrialWithContext;

const values = reduceMitataTrial(trial);

function rowsFor(op: Op): ReturnType<typeof rowsInOrder> {
  return rowsInOrder(
    values[op],
    datasets.map((ds) => ds.name),
  );
}

function gitShaOr(fallback: string): string {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  return sha || fallback;
}

const usedCandidates = candidates.filter((c) => used.has(c.name));

const env = {
  clk: `~${trial.context.cpu.freq.toFixed(2)} GHz`,
  cpu: trial.context.cpu.name ?? "unknown",
  runtime: `${trial.context.runtime ?? "node"} ${trial.context.version ?? ""} (${trial.context.arch ?? "unknown"})`,
};

const now = new Date();
const doc = {
  suite: "speed" as const,
  scope: scopeLabel(scope),
  tool: "mitata",
  unit: "ns/iter",
  lower_is_better: true,
  schema_version: 1,
  generated: now.toISOString().slice(0, 10),
  generated_at: now.toISOString(),
  source: process.env.BENCH_SOURCE ?? gitShaOr("local"),
  env,
  libraries: usedCandidates.map(libraryMeta),
  operations: { parse: rowsFor("parse"), stringify: rowsFor("stringify") },
};

mkdirSync(dirname(OUT), { recursive: true });
SpeedDocSchema.parse(doc); // fail fast if the emitted doc doesn't match its schema
writeFileSync(OUT, toYaml(doc));
console.log(`Wrote ${OUT}`);
