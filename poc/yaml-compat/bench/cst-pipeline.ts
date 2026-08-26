/**
 * CST compat pipeline benchmark — measures POC CSTParser→Composer vs real yaml.
 *
 * Methodology: warmup=3, iters=50 (15 for >1MB), median, sequential,
 * single-threaded. Matches the ±30% reproducibility requirement.
 *
 * Run: node --import tsx poc/yaml-compat/bench/cst-pipeline.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  Parser as RealParser,
  Composer as RealComposer,
  LineCounter as RealLineCounter,
} from "yaml";
import {
  Parser as CSTParser,
  Composer,
  LineCounter,
} from "../src/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORPUS = join(HERE, "corpus");

const WARMUP = 3;
const ITERS = Number(process.env.BENCH_ITERS) || 50;
const LARGE_THRESHOLD = 1_000_000;
const LARGE_ITERS = 15;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function timeIt(fn: () => void, iters: number): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples) * 1000; // ms → μs
}

interface Result {
  name: string;
  poc_us: number;
  real_us: number;
  ratio: number;
}

function main(): void {
  const files = readdirSync(CORPUS)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  console.log(`CST compat pipeline — ${files.length} fixtures, warmup=${WARMUP}, iters=${ITERS} (large: ${LARGE_ITERS})`);
  console.log(`Node ${process.version}, ${process.platform} ${process.arch}\n`);

  const results: Result[] = [];

  for (const f of files) {
    const name = f.replace(/\.yaml$/, "");
    const text = readFileSync(join(CORPUS, f), "utf8");
    const iters = text.length > LARGE_THRESHOLD ? LARGE_ITERS : ITERS;
    const isMultidoc = name.startsWith("multidoc-");

    // POC: CSTParser → Composer
    const pocUs = timeIt(() => {
      const lc = new LineCounter();
      const p = new CSTParser(lc.addNewLine);
      const tokens = [...p.parse(text)];
      const c = new Composer({ strict: false, uniqueKeys: false });
      [...c.compose(tokens, true, text.length)];
    }, iters);

    // Real yaml: Parser → Composer
    const realUs = timeIt(() => {
      const lc = new RealLineCounter();
      const p = new RealParser(lc.addNewLine);
      const tokens = [...p.parse(text)];
      const c = new RealComposer({ strict: false, uniqueKeys: false });
      [...c.compose(tokens, true, text.length)];
    }, iters);

    const ratio = Number((realUs / pocUs).toFixed(2));
    results.push({ name, poc_us: Math.round(pocUs), real_us: Math.round(realUs), ratio });
    const verdict = ratio >= 1 ? "faster" : "slower";
    console.log(`  ${name.padEnd(30)} poc=${Math.round(pocUs)}μs  real=${Math.round(realUs)}μs  ratio=${ratio}x (${verdict})`);
  }

  // Write results
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const gitSha = sha.status === 0 ? sha.stdout.trim() : "unknown";
  const fasterCount = results.filter((r) => r.ratio >= 1).length;
  const slowerCount = results.filter((r) => r.ratio < 1).length;
  const bestRatio = Math.max(...results.map((r) => r.ratio));
  const worstResult = results.reduce((a, b) => (a.ratio < b.ratio ? a : b));

  const lines: string[] = [];
  lines.push("# CST compat pipeline benchmark — Parser→tokens→Composer vs real yaml");
  lines.push(`# <!-- bench:poc/yaml-cst-compat ly:${gitSha} -->`);
  lines.push("# Pipeline: CSTParser → tokens → Composer → Document[]");
  lines.push("# Compared: yaml v2 Parser → tokens → Composer → Document[]");
  lines.push(`# Methodology: warmup=${WARMUP}, iters=${ITERS} (>${LARGE_THRESHOLD / 1e6}MB: ${LARGE_ITERS}), median, sequential`);
  lines.push(`# Machine: node ${process.version}, ${process.platform} ${process.arch}`);
  lines.push("");
  lines.push("suite: cst-compat-pipeline");
  lines.push("scope: poc");
  lines.push(`date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push("fixtures:");
  for (const r of results) {
    lines.push(`  - name: ${r.name}`);
    lines.push(`    poc_us: ${r.poc_us}`);
    lines.push(`    real_us: ${r.real_us}`);
    lines.push(`    ratio: ${r.ratio}`);
    lines.push(`    verdict: ${r.ratio >= 1 ? "faster" : "slower"}`);
    lines.push("");
  }
  lines.push("summary:");
  lines.push(`  faster_count: ${fasterCount}`);
  lines.push(`  slower_count: ${slowerCount}`);
  lines.push(`  best_ratio: ${bestRatio}`);
  lines.push(`  worst_ratio: ${worstResult.ratio}`);
  lines.push(`  worst_fixture: ${worstResult.name}`);
  lines.push("");

  const outPath = join(HERE, "..", "results", "cst.yaml");
  writeFileSync(outPath, lines.join("\n"));
  console.log(`\nResults written to ${outPath}`);
}

main();
