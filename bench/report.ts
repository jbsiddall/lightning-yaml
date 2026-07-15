/**
 * Refresh the benchmark YAML data — results/benchmarks/{speed,memory}.yaml.
 * Two modes, matching the two refresh cadences (see CLAUDE.md):
 *
 *   node --expose-gc --import tsx bench/report.ts self
 *     Benchmarks ONLY this repo's own parser (group "ours") + JSON baseline.
 *     Fast. Run before every commit/PR. If no lightning-yaml parser exists
 *     yet, prints a caveat and exits — nothing to benchmark.
 *
 *   node --expose-gc --import tsx bench/report.ts competition
 *     Benchmarks every parser (JSON + js-yaml + yaml + lightning-yaml) across
 *     the full matrix. Slow (xlarge/yaml). Run only when dependency versions
 *     or datasets change, or a milestone is worth a fresh snapshot.
 *
 * Both modes write results/benchmarks/speed.yaml + memory.yaml — gitignored,
 * single-doc YAML (no leading `---`). CI appends these as history onto the
 * orphan `benchmark-data` branch that the docs site reads.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { candidatesInGroup, candidateSupports, type Scope } from "./candidates.ts";
import { emitMemoryYaml } from "./memory/run.ts";

const emitSpeedPath = fileURLToPath(new URL("./speed/emit.ts", import.meta.url));

/** Run the speed emitter in an isolated child process — best timing fidelity. */
function runSpeedEmit(scope: Scope): void {
  const p = spawnSync(process.execPath, ["--expose-gc", "--import", "tsx", emitSpeedPath], {
    stdio: "inherit",
    env: { ...process.env, BENCH_SCOPE: scope, FORCE_COLOR: "0" },
  });
  if (p.status !== 0) throw new Error(`speed/emit.ts failed (exit ${p.status})`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === "competition") {
    console.log("Benchmarking all parsers (JSON + js-yaml + yaml + lightning-yaml), full matrix…");
    runSpeedEmit("all");
    emitMemoryYaml("all");
  } else if (mode === "self") {
    const ours = candidatesInGroup("ours");
    const ready = ours.filter((c) => candidateSupports(c, "parse") || candidateSupports(c, "stringify"));
    if (ready.length === 0) {
      console.log(
        "lightning-yaml is still a stub (parse/stringify throw) — nothing to benchmark.\n" +
          "This refreshes automatically once src/index.ts implements them; until then, " +
          "`pnpm test` runs the consistency suite that specifies what \"correct\" means.",
      );
      return;
    }
    console.log(`Benchmarking our implementation (${ready.map((c) => c.name).join(", ")}) + JSON baseline…`);
    runSpeedEmit("ours");
    emitMemoryYaml("ours");
  } else {
    console.error("Usage: report.ts <self|competition>");
    process.exit(1);
  }
}

await main();
