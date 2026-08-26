/**
 * Stringify benchmark — yaml lib vs POC, parsing to Document then toString().
 *
 * Measures median MB/s for stringify(doc) across all corpus fixtures.
 *
 * Run:  node --expose-gc --import tsx poc/yaml-compat/bench/stringify.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import * as yamlLib from "yaml";
import {
  parseDocument as pocParseDocument,
  parseAllDocuments as pocParseAllDocuments,
} from "../src/index.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORPUS = join(HERE, "corpus");
const RESULTS = join(HERE, "..", "results");

const ITERS = Number(process.env.BENCH_ITERS) || 15;

// ---- corpus loading --------------------------------------------------------
interface Fixture {
  name: string;
  bytes: number;
  text: string;
  isMultidoc: boolean;
}

function loadCorpus(): Fixture[] {
  return readdirSync(CORPUS)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const text = readFileSync(join(CORPUS, f), "utf8");
      return {
        name: f.replace(/\.yaml$/, ""),
        bytes: Buffer.byteLength(text),
        text,
        isMultidoc: f.startsWith("multidoc-"),
      };
    });
}

// ---- speed measurement -----------------------------------------------------
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function timeSync(
  fn: () => void,
  iters: number,
  fixtureBytes: number,
): { medianMs: number; mbps: number } | { error: string } {
  // warm-up
  try { fn(); } catch (e) { return { error: (e as Error).message ?? String(e) }; }
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    try { fn(); } catch (e) { return { error: (e as Error).message ?? String(e) }; }
    samples.push(performance.now() - t0);
  }
  const medianMs = median(samples);
  const mbps = (fixtureBytes / (1024 * 1024)) / (medianMs / 1000);
  return { medianMs, mbps };
}

interface Row {
  library: string;
  op: string;
  medianMs: number;
  mbps: number;
  status?: "error";
  reason?: string;
}

function measure(fx: Fixture): Row[] {
  const { text, bytes, isMultidoc } = fx;
  const iters = bytes > 1_000_000 ? Math.max(3, ITERS >> 2) : ITERS;
  const out: Row[] = [];

  function push(library: string, op: string, r: ReturnType<typeof timeSync>): void {
    if ("error" in r) {
      out.push({ library, op, medianMs: 0, mbps: 0, status: "error", reason: r.error });
      console.log(`    [error] ${library}/${op} — ${r.error}`);
    } else {
      out.push({ library, op, medianMs: r.medianMs, mbps: r.mbps });
    }
  }

  push("yaml", "stringify(doc)", timeSync(() => {
    if (isMultidoc) {
      const docs = yamlLib.parseAllDocuments(text);
      for (const d of docs) d.toString();
    } else {
      yamlLib.parseDocument(text).toString();
    }
  }, iters, bytes));

  push("poc", "stringify(doc)", timeSync(() => {
    if (isMultidoc) {
      const docs = pocParseAllDocuments(text);
      for (const d of docs) d.toString();
    } else {
      pocParseDocument(text).toString();
    }
  }, iters, bytes));

  return out;
}

// ---- output ----------------------------------------------------------------
function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

function yamlScalar(v: string | number): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (/[:#\[\]{},&*?|>'"%@`]/.test(v) || /^\s|\s$/.test(v)) return JSON.stringify(v);
  return v;
}

function writeResults(data: Array<{ fixture: Fixture; rows: Row[]; iters: number }>): void {
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const gitSha = sha.status === 0 ? sha.stdout.trim() : "unknown";
  const lines: string[] = [
    "# Stringify benchmark results — poc/yaml-compat",
    `# machine: ${process.platform} ${process.arch}`,
    `# node: ${process.version}`,
    `# yaml: 2.9.0`,
    `# poc: ${gitSha}`,
    `# date: ${new Date().toISOString()}`,
    `# git-sha: ${gitSha}`,
    `# iters: ${ITERS} (fixtures >1MB: ${Math.max(3, ITERS >> 2)})`,
    `# methodology: median MB/s, sequential, warm-up 1 iter`,
    "",
    "speed:",
  ];

  for (const { fixture, rows, iters } of data) {
    lines.push(`  - fixture: ${yamlScalar(fixture.name)}`);
    lines.push(`    size_bytes: ${fixture.bytes}`);
    lines.push(`    iters: ${iters}`);
    lines.push(`    rows:`);
    for (const r of rows) {
      lines.push(`      - library: ${yamlScalar(r.library)}`);
      lines.push(`        op: ${yamlScalar(r.op)}`);
      if (r.status === "error") {
        lines.push(`        status: error`);
        lines.push(`        reason: ${yamlScalar(r.reason ?? "unknown")}`);
      } else {
        lines.push(`        median_ms: ${r.medianMs.toFixed(3)}`);
        lines.push(`        mbps: ${r.mbps.toFixed(2)}`);
      }
    }
  }

  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
  const outPath = join(RESULTS, "stringify.yaml");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nResults written to ${outPath}`);
  console.log("  (results/ is gitignored — use `git add -f` to stage if needed)");
}

// ---- main ------------------------------------------------------------------
function main(): void {
  const corpus = loadCorpus();
  console.log(`Stringify benchmark — ${corpus.length} fixtures`);
  console.log(`  iters: ${ITERS} (large: ${Math.max(3, ITERS >> 2)})`);
  console.log(`  Node ${process.version}\n`);

  const data: Array<{ fixture: Fixture; rows: Row[]; iters: number }> = [];

  for (const fx of corpus) {
    const iters = fx.bytes > 1_000_000 ? Math.max(3, ITERS >> 2) : ITERS;
    console.log(`  ${fx.name} (${fmtBytes(fx.bytes)}, ${iters} iters)`);
    const rows = measure(fx);
    data.push({ fixture: fx, rows, iters });
    for (const r of rows) {
      if (r.status === "error") {
        console.log(`    ${r.library.padEnd(6)} ${r.op.padEnd(16)} ERROR: ${r.reason}`);
      } else {
        console.log(`    ${r.library.padEnd(6)} ${r.op.padEnd(16)} ${r.mbps.toFixed(1).padStart(8)} MB/s  (${r.medianMs.toFixed(3)} ms)`);
      }
    }
  }

  writeResults(data);

  // Summary ratios
  console.log("\n== Summary (poc / yaml speedup) ==");
  for (const { fixture, rows } of data) {
    const yamlRow = rows.find((r) => r.library === "yaml" && !r.status);
    const pocRow = rows.find((r) => r.library === "poc" && !r.status);
    if (yamlRow && pocRow) {
      const ratio = (pocRow.mbps / yamlRow.mbps).toFixed(2);
      console.log(`  ${fixture.name.padEnd(35)} ${ratio}x`);
    }
  }
}

main();
