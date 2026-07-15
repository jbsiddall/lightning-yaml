/**
 * Conformance runner — scores lightning-yaml, js-yaml, and `yaml` against the
 * vendored yaml-test-suite (see ../yaml-test-suite/fetch.sh and ./suite.ts).
 *
 *   pnpm gen:suite               # fetch the pinned suite snapshot (idempotent)
 *   node --import tsx bench/conformance/run.ts [--dump-failures]
 *   pnpm test:suite              # runs both of the above in sequence
 *
 * Scoring:
 *   - positive case (has in.json)  -> PASS iff the parser doesn't throw AND
 *     its ordered document sequence deep-equals the expected sequence.
 *   - negative case (has `error`, no in.json) -> PASS iff the parser throws.
 *   - neither file present -> unscorable (event-stream-only fixtures with no
 *     JSON representation); skipped identically for all three parsers so the
 *     comparison stays apples-to-apples.
 *
 * We are NOT cross-checking competitors against each other for correctness
 * (see bench/oracle.ts's rationale) — here all three are independently scored
 * against the suite's own expected values, which is the point of this
 * harness: an external, spec-authored ground truth.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load as jsYamlLoadSingle, loadAll as jsYamlLoadAll } from "js-yaml";
import { parseAllDocuments, stringify as toYaml } from "yaml";
import { parse as ourParse, parseAll as ourParseAll } from "../../src/index.ts";
import { candidateByName, libraryMeta } from "../candidates.ts";
import { deepEqualSequences } from "./deepEqual.ts";
import { classifyFailure, BUCKET_PRIORITY, type Bucket } from "./classify.ts";
import { loadSuite, type TestCase } from "./suite.ts";

const DATA_DIR = fileURLToPath(new URL("../yaml-test-suite/data", import.meta.url));
const OUT_YAML = fileURLToPath(new URL("../../results/benchmarks/conformance.yaml", import.meta.url));

function gitShaOr(fallback: string): string {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const sha = r.status === 0 ? r.stdout.trim() : "";
  return sha || fallback;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface ParserCandidate {
  name: string;
  parseDocs: (text: string) => unknown[];
}

/**
 * Ours: parseAll is the multi-document entry point. Fall back to wrapping a
 * single parse() call only if parseAll itself isn't exported (defensive —
 * today parseAll always delegates to parse, so this is a no-op fallback, not
 * an error-swallowing one: a genuine parse error still propagates either way).
 */
function ourParseDocs(text: string): unknown[] {
  if (typeof ourParseAll === "function") return ourParseAll(text);
  return [ourParse(text)];
}

function jsYamlParseDocs(text: string): unknown[] {
  const docs = jsYamlLoadAll(text);
  // js-yaml's loadAll(text) (no iterator callback) returns an array; guard
  // anyway in case a single scalar-only stream ever comes back unwrapped.
  return Array.isArray(docs) ? docs : [jsYamlLoadSingle(text)];
}

function yamlLibParseDocs(text: string): unknown[] {
  // `maxAliasCount` disables `yaml`'s default 100-alias DoS guard (same
  // rationale as bench/oracle.ts) — it belongs to ToJSOptions (passed to
  // .toJS()), not to parseAllDocuments's own ParseOptions/DocumentOptions.
  const docs = parseAllDocuments(text);
  return docs.map((doc) => {
    if (doc.errors.length > 0) {
      throw new Error(doc.errors[0]?.message ?? "yaml: document has errors");
    }
    return doc.toJS({ maxAliasCount: -1 });
  });
}

const CANDIDATES: ParserCandidate[] = [
  { name: "lightning-yaml", parseDocs: ourParseDocs },
  { name: "js-yaml", parseDocs: jsYamlParseDocs },
  { name: "yaml", parseDocs: yamlLibParseDocs },
];

const OURS = CANDIDATES[0]!;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface CaseResult {
  passed: boolean;
  /** Failure reason, for debugging / classification. Undefined when passed. */
  reason?: string;
}

function evaluate(candidate: ParserCandidate, tc: TestCase): CaseResult {
  if (tc.kind === "positive") {
    let docs: unknown[];
    try {
      docs = candidate.parseDocs(tc.yaml);
    } catch (err) {
      return { passed: false, reason: `threw: ${(err as Error).message ?? String(err)}` };
    }
    const ok = deepEqualSequences(docs, tc.expected!);
    return { passed: ok, reason: ok ? undefined : "value mismatch" };
  }

  if (tc.kind === "negative") {
    try {
      candidate.parseDocs(tc.yaml);
      return { passed: false, reason: "did not throw" };
    } catch {
      return { passed: true };
    }
  }

  // unscorable — never called for these, but keep this total.
  return { passed: false, reason: "unscorable" };
}

interface Tally {
  positivePassed: number;
  positiveTotal: number;
  negativePassed: number;
  negativeTotal: number;
}

function emptyTally(): Tally {
  return { positivePassed: 0, positiveTotal: 0, negativePassed: 0, negativeTotal: 0 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const dumpFailures = process.argv.includes("--dump-failures");

  if (!existsSync(DATA_DIR)) {
    console.error(`yaml-test-suite data not found at ${DATA_DIR}`);
    console.error(`Run "pnpm gen:suite" first.`);
    process.exit(1);
  }

  const cases = loadSuite(DATA_DIR);
  const scored = cases.filter((c) => c.kind !== "unscorable");
  const unscorable = cases.filter((c) => c.kind === "unscorable");

  const tallies = new Map<string, Tally>(CANDIDATES.map((c) => [c.name, emptyTally()]));
  // Per scored case: which candidates passed (for the cross-candidate sets).
  const passedBy = new Map<string, Set<string>>(); // case id -> set of candidate names that passed
  // Ours-only failure detail, for classification + optional dump.
  const ourFailures: { tc: TestCase; reason: string }[] = [];

  for (const tc of scored) {
    const passedSet = new Set<string>();
    for (const candidate of CANDIDATES) {
      const result = evaluate(candidate, tc);
      const tally = tallies.get(candidate.name)!;
      if (tc.kind === "positive") {
        tally.positiveTotal++;
        if (result.passed) tally.positivePassed++;
      } else {
        tally.negativeTotal++;
        if (result.passed) tally.negativePassed++;
      }
      if (result.passed) passedSet.add(candidate.name);
      else if (candidate === OURS) ourFailures.push({ tc, reason: result.reason ?? "failed" });
    }
    passedBy.set(tc.id, passedSet);
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  console.log("yaml-test-suite conformance report");
  console.log("===================================");
  console.log(`Suite data: ${DATA_DIR}`);
  console.log();
  console.log(`Total cases:      ${cases.length}`);
  console.log(`  scored:         ${scored.length}`);
  console.log(`  unscorable:     ${unscorable.length}  (no in.json and no error file — skipped for all parsers)`);
  console.log();

  console.log("Pass rate per parser (over the scored set):");
  for (const candidate of CANDIDATES) {
    const t = tallies.get(candidate.name)!;
    const totalPassed = t.positivePassed + t.negativePassed;
    const total = t.positiveTotal + t.negativeTotal;
    const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
    console.log(
      `  ${candidate.name.padEnd(16)} ${totalPassed}/${total} (${pct(totalPassed, total)})` +
        `   positive: ${t.positivePassed}/${t.positiveTotal} (${pct(t.positivePassed, t.positiveTotal)})` +
        `   negative: ${t.negativePassed}/${t.negativeTotal} (${pct(t.negativePassed, t.negativeTotal)})`,
    );
  }
  console.log();

  // --- OUR failures grouped by inferred cause -------------------------------

  const primaryGroups = new Map<Bucket, TestCase[]>(BUCKET_PRIORITY.map((b) => [b, []]));
  const rawFrequency = new Map<Bucket, number>(BUCKET_PRIORITY.map((b) => [b, 0]));

  for (const { tc } of ourFailures) {
    const { primary, matched } = classifyFailure(tc.yaml);
    primaryGroups.get(primary)!.push(tc);
    for (const b of matched) rawFrequency.set(b, (rawFrequency.get(b) ?? 0) + 1);
  }

  console.log(`OUR (lightning-yaml) failures: ${ourFailures.length}/${scored.length}, grouped by inferred cause:`);
  console.log("(primary bucket = highest-priority construct found; a case may match several — see below)");
  for (const bucket of BUCKET_PRIORITY) {
    const group = primaryGroups.get(bucket)!;
    if (group.length === 0) continue;
    const examples = group.slice(0, 5).map((tc) => tc.id).join(", ");
    console.log(`  ${bucket.padEnd(20)} ${String(group.length).padStart(4)}   e.g. ${examples}`);
  }
  console.log();

  console.log("Secondary: raw construct frequency among OUR failures (multi-label, sums may exceed failure count):");
  for (const bucket of BUCKET_PRIORITY) {
    const n = rawFrequency.get(bucket) ?? 0;
    if (n === 0) continue;
    console.log(`  ${bucket.padEnd(20)} ${n}`);
  }
  console.log();

  // --- Cross-candidate sets --------------------------------------------------

  let fixable = 0; // ours fails, both js-yaml and yaml pass
  let specCorner = 0; // ours fails, yaml (our oracle-grade reference) also fails

  for (const { tc } of ourFailures) {
    const passedSet = passedBy.get(tc.id)!;
    const jsYamlPassed = passedSet.has("js-yaml");
    const yamlPassed = passedSet.has("yaml");
    if (jsYamlPassed && yamlPassed) fixable++;
    if (!yamlPassed) specCorner++;
  }

  console.log("Cross-candidate breakdown of OUR failures:");
  console.log(`  ours fails, both js-yaml AND yaml pass (clearly-fixable): ${fixable}`);
  console.log(`  ours fails, yaml ALSO fails (spec-corner non-goal, skip): ${specCorner}`);
  console.log();

  if (dumpFailures) {
    console.log(`Full list of OUR failing case IDs (${ourFailures.length}):`);
    for (const { tc, reason } of ourFailures) {
      console.log(`  ${tc.id}  [${reason}]  ${tc.description}`);
    }
  } else {
    console.log("(pass --dump-failures to print the full list of OUR failing case IDs)");
  }

  // ---------------------------------------------------------------------------
  // Emit results/benchmarks/conformance.yaml — best-effort: a write failure
  // here (e.g. read-only FS) must never turn a passing conformance run red.
  // ---------------------------------------------------------------------------

  try {
    const require = createRequire(import.meta.url);

    const results = CANDIDATES.map((candidate) => {
      const t = tallies.get(candidate.name)!;
      const passed = t.positivePassed + t.negativePassed;
      const total = t.positiveTotal + t.negativeTotal;
      const score = total === 0 ? 0 : +((100 * passed) / total).toFixed(1);
      const meta = libraryMeta(candidateByName(candidate.name));
      return {
        id: meta.id,
        label: meta.label,
        ...(meta.self ? { self: true } : {}),
        ...(candidate.name === "js-yaml"
          ? { version: (require("js-yaml/package.json") as { version: string }).version }
          : {}),
        passed,
        total,
        score,
        ...(candidate.name === "lightning-yaml"
          ? { negative_passed: t.negativePassed, negative_total: t.negativeTotal }
          : {}),
      };
    }).sort((a, b) => b.score - a.score);

    const doc = {
      suite: "conformance" as const,
      scope: "competition" as const,
      suite_total: scored.length,
      unit: "%",
      higher_is_better: true,
      generated: new Date().toISOString().slice(0, 10),
      source: process.env.BENCH_SOURCE ?? gitShaOr("local"),
      results,
    };

    mkdirSync(dirname(OUT_YAML), { recursive: true });
    writeFileSync(OUT_YAML, toYaml(doc));
    console.log(`Wrote ${OUT_YAML}`);
  } catch (err) {
    console.error(`(non-fatal) failed to write ${OUT_YAML}: ${(err as Error).message ?? err}`);
  }
}

main();
