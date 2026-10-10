#!/usr/bin/env node
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supervise } from "./quick-supervisor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [, , baseline, candidate, outArg] = process.argv;
if (!baseline || !candidate) throw new Error("usage: pnpm bench:quick BASELINE_ROOT CANDIDATE_ROOT [OUTPUT.json]");
const out = resolve(outArg ?? "/tmp/ly-dafny-quick-benchmark-result.json");
const result = await supervise({
  command: process.execPath,
  args: ["--import", "tsx", join(HERE, "quick-runner.mjs"), baseline, candidate, out],
  cwd: resolve(HERE, "../.."), out, limitMs: 60_000, stdio: "inherit",
});
process.stdout.write(`${result.status}: ${result.elapsedMs}ms; output ${out}\n`);
process.exitCode = result.exitCode;
