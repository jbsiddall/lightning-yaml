/**
 * Differential compat report for the DROP-IN SHIMS (src/js-yaml-compat.ts,
 * src/yaml-compat.ts) — a different question from bench/conformance/run.ts
 * (which scores OUR PARSER's correctness against the yaml-test-suite). Here
 * we ask: "if a codebase swaps its `js-yaml`/`yaml` import for one of our
 * shims, how often does it see the SAME behavior as the real library?"
 *
 *   pnpm test:compat
 *   node --import tsx bench/conformance/compat.ts [--dump-examples]
 *
 * For each shim we run two kinds of checks over a corpus of YAML inputs:
 *
 *   - read:  shim.load/parse(yaml) vs. the real library's load/parse(yaml).
 *     PASS iff the two values deep-equal (key-order-insensitive — see
 *     ./deepEqual.ts) OR both throw. This is exactly Deliverable 3's ask:
 *       js-yaml-compat.load(x)  vs. real js-yaml.load(x)
 *       yaml-compat.parse(x)    vs. real yaml.parse(x)
 *
 *   - dump:  a value obtained from the REAL library's parse of the same input
 *     is round-tripped through shim.dump/stringify(value) vs. the real
 *     library's dump/stringify(value). PASS iff both throw, or both succeed
 *     AND re-parsing the shim's output (through the REAL library) deep-equals
 *     the original value. Our `stringify` is implemented (M6), so these dump
 *     checks now genuinely round-trip instead of failing wholesale; the
 *     "dump/stringify-unimplemented" bucket only fires if our dumper throws
 *     while the real library succeeds. This check runs ONLY over the curated
 *     corpus (not the yaml-test-suite fold-in): the point of folding in
 *     yaml-test-suite is read-side construct BREADTH, and running ~350 more
 *     dump checks over it would balloon the report without adding read-side
 *     signal.
 *
 * Corpus: a curated set of ~50-80 hand-written snippets (below), covering
 * plain/quoted scalars, 1.2-core typing, flow & block maps/seqs, multi-doc
 * streams, comments, constructs we don't parse yet (block scalars, anchors/
 * aliases, tags, merge keys), and js-yaml-1.1-isms (yes/no/on/off,
 * sexagesimal, 0b/0o/legacy-octal, underscore separators, timestamps) — PLUS,
 * if bench/yaml-test-suite/data/ has been fetched (`pnpm gen:suite`), every
 * suite case's `in.yaml` folded in for read-side breadth (skipped gracefully
 * if absent).
 *
 * Failures are grouped by inferred construct, mirroring run.ts's style, so
 * the orchestrator can pick the highest-impact feature to implement next:
 * most of these buckets (block-scalar, anchor-alias, tag, schema-1.1) close
 * automatically as the parser itself grows — they
 * are NOT gaps in this compat layer specifically.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load as jsYamlRealLoad, dump as jsYamlRealDump } from "js-yaml";
import { parse as yamlRealParse, stringify as yamlRealStringify } from "yaml";
import { load as shimJsYamlLoad, dump as shimJsYamlDump } from "../../src/js-yaml-compat.ts";
import { parse as shimYamlParse, stringify as shimYamlStringify } from "../../src/yaml-compat.ts";
import { deepEqual } from "./deepEqual.ts";
import { classifyFailure } from "./classify.ts";
import { loadSuite } from "./suite.ts";

// ---------------------------------------------------------------------------
// Bucket vocabulary (per the task brief — distinct from classify.ts's, which
// buckets our PARSER's own conformance gaps rather than shim-vs-real-library
// behavioral divergences).
// ---------------------------------------------------------------------------

type Bucket = "block-scalar" | "anchor-alias" | "tag" | "multi-doc" | "schema-1.1" | "quoting" | "plain-typing" | "dump-unimplemented" | "other";

const BUCKET_ORDER: Bucket[] = ["block-scalar", "anchor-alias", "tag", "multi-doc", "schema-1.1", "quoting", "plain-typing", "dump-unimplemented", "other"];

const BUCKET_LABEL: Record<Bucket, string> = {
  "block-scalar": "block-scalar",
  "anchor-alias": "anchor-alias",
  tag: "tag",
  "multi-doc": "multi-doc",
  "schema-1.1": "schema-1.1 (js-yaml 1.1 vs our 1.2-core)",
  quoting: "quoting",
  "plain-typing": "plain-typing",
  "dump-unimplemented": "dump/stringify-unimplemented",
  other: "other",
};

// ---------------------------------------------------------------------------
// Best-effort text classifier for yaml-test-suite-derived cases (which have
// no hand-assigned bucket). Reuses classify.ts's regex-backed detectors for
// the constructs it already covers (block scalars / anchors / tags / merge
// keys / directives / doc markers) instead of re-deriving them, and adds
// detectors for the two buckets classify.ts doesn't have: schema-1.1
// (js-yaml-1.1-isms our 1.2-core doesn't resolve) and quoting.
// ---------------------------------------------------------------------------

const RE_1_1_YESNO = /:\s*(?:[Yy]es|[Nn]o|[Oo]n|[Oo]ff|YES|NO|ON|OFF)\s*(?:#.*)?$/m;
const RE_1_1_SEXAGESIMAL = /:\s*-?\d+(?::[0-5]?\d){1,}(?:\.\d+)?\s*(?:#.*)?$/m;
const RE_1_1_BINARY = /:\s*-?0b[01]+\s*(?:#.*)?$/m;
const RE_1_1_UNDERSCORE = /:\s*-?\d[\d_]*_[\d_]*\d\s*(?:#.*)?$/m;
const RE_1_1_TIMESTAMP = /:\s*\d{4}-\d{1,2}-\d{1,2}([Tt ]\d{1,2}:\d{2}:\d{2})?/;
const RE_1_1_LEGACY_OCTAL = /:\s*-?0[0-7]+\s*(?:#.*)?$/m; // ambiguous with plain decimal — heuristic only
const RE_QUOTED = /["']/;

function inferBucket(yaml: string): Bucket {
  const { matched } = classifyFailure(yaml);
  if (matched.includes("block-scalar")) return "block-scalar";
  if (matched.includes("anchor-alias")) return "anchor-alias";
  if (matched.includes("tag") || matched.includes("merge-key")) return "tag";
  if (matched.includes("doc-markers") || matched.includes("directive")) return "multi-doc";
  if (
    RE_1_1_YESNO.test(yaml) ||
    RE_1_1_SEXAGESIMAL.test(yaml) ||
    RE_1_1_BINARY.test(yaml) ||
    RE_1_1_UNDERSCORE.test(yaml) ||
    RE_1_1_TIMESTAMP.test(yaml) ||
    RE_1_1_LEGACY_OCTAL.test(yaml)
  ) {
    return "schema-1.1";
  }
  if (RE_QUOTED.test(yaml)) return "quoting";
  return "plain-typing";
}

// ---------------------------------------------------------------------------
// Curated corpus (~65 snippets). Each carries its OWN best-guess bucket —
// since we authored these ourselves, we know what each is testing, so no
// text inference is needed for these (inference is reserved for the
// yaml-test-suite fold-in below, where hand-labeling ~350 cases isn't
// practical).
// ---------------------------------------------------------------------------

interface CorpusEntry {
  name: string;
  yaml: string;
  bucket: Bucket;
}

const CORPUS: CorpusEntry[] = [
  // --- plain scalars, 1.2 core typing ---------------------------------------
  { name: "plain-null-tilde", yaml: "~", bucket: "plain-typing" },
  { name: "plain-null-word", yaml: "null", bucket: "plain-typing" },
  { name: "plain-true", yaml: "true", bucket: "plain-typing" },
  { name: "plain-false", yaml: "false", bucket: "plain-typing" },
  { name: "plain-int", yaml: "42", bucket: "plain-typing" },
  { name: "plain-negative-int", yaml: "-17", bucket: "plain-typing" },
  { name: "plain-float", yaml: "3.14", bucket: "plain-typing" },
  { name: "plain-string", yaml: "hello world", bucket: "plain-typing" },
  { name: "plain-hex", yaml: "a: 0x1A\n", bucket: "plain-typing" },
  { name: "plain-octal-1.2", yaml: "a: 0o17\n", bucket: "plain-typing" },
  { name: "plain-inf", yaml: "a: .inf\n", bucket: "plain-typing" },
  { name: "plain-neg-inf", yaml: "a: -.inf\n", bucket: "plain-typing" },
  { name: "plain-nan", yaml: "a: .nan\n", bucket: "plain-typing" },
  { name: "plain-exponent-float", yaml: "a: 1.5e+3\n", bucket: "plain-typing" },
  { name: "plain-leading-dot-float", yaml: "a: .5\n", bucket: "plain-typing" },
  { name: "plain-big-int", yaml: "a: 123456789012345678\n", bucket: "plain-typing" },

  // --- quoted scalars --------------------------------------------------------
  { name: "double-quoted-escapes", yaml: '"line1\\nline2\\ttab"', bucket: "quoting" },
  { name: "single-quoted-escape", yaml: "'it''s'", bucket: "quoting" },
  { name: "double-quoted-unicode", yaml: '"\\u00e9\\u4e2d"', bucket: "quoting" },
  { name: "single-quoted-plain", yaml: "'plain string'", bucket: "quoting" },
  { name: "double-quoted-empty", yaml: '""', bucket: "quoting" },
  { name: "double-quoted-number-looking", yaml: '"42"', bucket: "quoting" },

  // --- flow collections --------------------------------------------------------
  { name: "flow-seq", yaml: "[1, 2, 3]", bucket: "plain-typing" },
  { name: "flow-map", yaml: "{a: 1, b: 2}", bucket: "plain-typing" },
  { name: "flow-nested", yaml: "{a: [1, 2], b: {c: 3}}", bucket: "plain-typing" },
  { name: "flow-seq-of-maps", yaml: "[{a: 1}, {b: 2}]", bucket: "plain-typing" },
  { name: "flow-empty-seq", yaml: "[]", bucket: "plain-typing" },
  { name: "flow-empty-map", yaml: "{}", bucket: "plain-typing" },

  // --- block collections -------------------------------------------------------
  { name: "block-map-simple", yaml: "a: 1\nb: 2\n", bucket: "plain-typing" },
  { name: "block-map-nested", yaml: "a:\n  b: 1\n  c: 2\n", bucket: "plain-typing" },
  { name: "block-seq", yaml: "- 1\n- 2\n- 3\n", bucket: "plain-typing" },
  { name: "block-seq-of-maps", yaml: "- a: 1\n  b: 2\n- a: 3\n  b: 4\n", bucket: "plain-typing" },
  { name: "block-map-seq-value", yaml: "items:\n  - x\n  - y\n", bucket: "plain-typing" },
  { name: "block-compact-seq", yaml: "list:\n- 1\n- 2\n", bucket: "plain-typing" },
  { name: "block-deeply-nested", yaml: "a:\n  b:\n    c:\n      - 1\n      - 2\n", bucket: "plain-typing" },
  { name: "block-mixed-flow", yaml: "a: [1, 2]\nb: {c: 3}\n", bucket: "plain-typing" },

  // --- multi-doc streams -------------------------------------------------------
  { name: "multi-doc-two", yaml: "---\na: 1\n---\nb: 2\n", bucket: "multi-doc" },
  { name: "multi-doc-end-marker", yaml: "a: 1\n...\n", bucket: "multi-doc" },
  { name: "multi-doc-three-scalars", yaml: "---\n1\n---\n2\n---\n3\n", bucket: "multi-doc" },
  { name: "multi-doc-with-directive", yaml: "%YAML 1.2\n---\na: 1\n", bucket: "multi-doc" },
  { name: "multi-doc-explicit-start-flow", yaml: "--- [1, 2, 3]\n", bucket: "multi-doc" },
  { name: "multi-doc-comment-after-marker", yaml: "--- # comment\na: 1\n", bucket: "multi-doc" },

  // --- comments ----------------------------------------------------------------
  { name: "comment-trailing", yaml: "a: 1 # comment\n", bucket: "plain-typing" },
  { name: "comment-leading", yaml: "# leading comment\na: 1\n", bucket: "plain-typing" },
  { name: "comment-own-line", yaml: "a: 1\n# trailing comment\n", bucket: "plain-typing" },
  { name: "comment-after-flow", yaml: "[1, 2] # trailing\n", bucket: "plain-typing" },

  // --- not-yet-implemented constructs ------------------------------------------
  { name: "block-scalar-literal", yaml: "a: |\n  line1\n  line2\n", bucket: "block-scalar" },
  { name: "block-scalar-folded", yaml: "a: >\n  line1\n  line2\n", bucket: "block-scalar" },
  { name: "block-scalar-literal-strip", yaml: "a: |-\n  line1\n", bucket: "block-scalar" },
  { name: "anchor-alias-scalar", yaml: "a: &x 1\nb: *x\n", bucket: "anchor-alias" },
  { name: "anchor-alias-map", yaml: "a: &anchor\n  x: 1\nb: *anchor\n", bucket: "anchor-alias" },
  { name: "tag-explicit-str", yaml: "a: !!str 123\n", bucket: "tag" },
  { name: "tag-binary", yaml: "a: !!binary |\n  aGVsbG8=\n", bucket: "tag" },
  { name: "merge-key", yaml: "a: &base\n  x: 1\nb:\n  <<: *base\n  y: 2\n", bucket: "tag" },
  { name: "explicit-complex-key", yaml: "? complex key\n: value\n", bucket: "other" },
  { name: "tag-custom-local", yaml: "a: !myTag value\n", bucket: "tag" },

  // --- js-yaml 1.1-isms (vs our / real `yaml`'s 1.2-core) ----------------------
  { name: "1.1-yes-no", yaml: "a: yes\nb: no\n", bucket: "schema-1.1" },
  { name: "1.1-on-off", yaml: "a: on\nb: off\n", bucket: "schema-1.1" },
  { name: "1.1-sexagesimal-int", yaml: "a: 1:20:30\n", bucket: "schema-1.1" },
  { name: "1.1-sexagesimal-float", yaml: "a: 1:20:30.5\n", bucket: "schema-1.1" },
  { name: "1.1-legacy-octal", yaml: "a: 017\n", bucket: "schema-1.1" },
  { name: "1.1-binary-0b", yaml: "a: 0b1010\n", bucket: "schema-1.1" },
  { name: "1.1-underscore-separators", yaml: "a: 1_000_000\n", bucket: "schema-1.1" },
  { name: "1.1-timestamp", yaml: "a: 2001-12-15T02:59:43.1Z\n", bucket: "schema-1.1" },
];

// ---------------------------------------------------------------------------
// Cases + checks
// ---------------------------------------------------------------------------

interface SourceCase {
  label: string;
  yaml: string;
  explicitBucket?: Bucket;
}

interface CheckOutcome {
  pass: boolean;
  bucket: Bucket;
  label: string;
  yaml: string;
  detail: string;
}

function bucketFor(c: SourceCase): Bucket {
  return c.explicitBucket ?? inferBucket(c.yaml);
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

/** shim.load/parse(yaml) vs. real.load/parse(yaml) — Deliverable 3's core check. */
function compareRead(shimFn: (s: string) => unknown, realFn: (s: string) => unknown, c: SourceCase): CheckOutcome {
  let shimVal: unknown;
  let shimThrew = false;
  let shimErr = "";
  try {
    shimVal = shimFn(c.yaml);
  } catch (err) {
    shimThrew = true;
    shimErr = err instanceof Error ? err.message : String(err);
  }
  let realVal: unknown;
  let realThrew = false;
  try {
    realVal = realFn(c.yaml);
  } catch {
    realThrew = true;
  }
  const pass = (shimThrew && realThrew) || (!shimThrew && !realThrew && deepEqual(shimVal, realVal));
  const detail = pass ? "" : shimThrew ? `shim threw: ${truncate(shimErr, 90)}` : realThrew ? "real lib threw, shim did not" : "value mismatch";
  return { pass, bucket: pass ? (c.explicitBucket ?? "other") : bucketFor(c), label: c.label, yaml: c.yaml, detail };
}

/**
 * A value from the REAL library's parse of `c.yaml` is round-tripped through
 * shim.dump/stringify vs. the real library's own dump/stringify. Returns
 * `null` when the real library itself can't produce a ground-truth value
 * (nothing to round-trip — not counted either way).
 */
function compareDump(
  shimDumpFn: (v: unknown) => string,
  realParseFn: (s: string) => unknown,
  realDumpFn: (v: unknown) => string,
  c: SourceCase,
): CheckOutcome | null {
  let value: unknown;
  try {
    value = realParseFn(c.yaml);
  } catch {
    return null;
  }
  let shimOut = "";
  let shimThrew = false;
  let shimErr = "";
  try {
    shimOut = shimDumpFn(value);
  } catch (err) {
    shimThrew = true;
    shimErr = err instanceof Error ? err.message : String(err);
  }
  let realThrew = false;
  try {
    realDumpFn(value);
  } catch {
    realThrew = true;
  }
  let pass: boolean;
  if (shimThrew && realThrew) {
    pass = true;
  } else if (!shimThrew && !realThrew) {
    try {
      pass = deepEqual(realParseFn(shimOut), value);
    } catch {
      pass = false;
    }
  } else {
    pass = false;
  }
  const bucket: Bucket = pass ? (c.explicitBucket ?? "other") : shimThrew && !realThrew ? "dump-unimplemented" : bucketFor(c);
  const detail = pass ? "" : shimThrew ? `shim threw: ${truncate(shimErr, 90)}` : realThrew ? "real lib threw, shim did not" : "round-trip mismatch";
  return { pass, bucket, label: `${c.label} (dump)`, yaml: c.yaml, detail };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printSection(
  shimName: string,
  realName: string,
  curated: SourceCase[],
  suite: SourceCase[],
  readCheck: (c: SourceCase) => CheckOutcome,
  dumpCheck: (c: SourceCase) => CheckOutcome | null,
  dumpExamples: boolean,
): void {
  const title = `${shimName} vs. real ${realName}`;
  console.log(title);
  console.log("=".repeat(title.length));

  const readCurated = curated.map(readCheck);
  const readSuite = suite.map(readCheck);
  const dumpOutcomes = curated.map(dumpCheck).filter((o): o is CheckOutcome => o !== null);

  const tally = (outcomes: CheckOutcome[]) => ({ pass: outcomes.filter((o) => o.pass).length, total: outcomes.length });
  const pct = (pass: number, total: number) => (total === 0 ? "n/a" : `${((100 * pass) / total).toFixed(1)}%`);

  const rc = tally(readCurated);
  const rs = tally(readSuite);
  const dc = tally(dumpOutcomes);
  const allOutcomes = [...readCurated, ...readSuite, ...dumpOutcomes];
  const overall = tally(allOutcomes);

  console.log(`  read (curated corpus):     ${rc.pass}/${rc.total} (${pct(rc.pass, rc.total)})`);
  if (rs.total > 0) {
    console.log(`  read (yaml-test-suite):     ${rs.pass}/${rs.total} (${pct(rs.pass, rs.total)})   (breadth fold-in)`);
  }
  console.log(`  dump (curated corpus only): ${dc.pass}/${dc.total} (${pct(dc.pass, dc.total)})`);
  console.log(`  OVERALL agreement:          ${overall.pass}/${overall.total} (${pct(overall.pass, overall.total)})`);
  console.log();

  const groups = new Map<Bucket, CheckOutcome[]>(BUCKET_ORDER.map((b) => [b, []]));
  for (const o of allOutcomes) {
    if (!o.pass) groups.get(o.bucket)!.push(o);
  }

  console.log("  failures grouped by inferred construct:");
  for (const b of BUCKET_ORDER) {
    const group = groups.get(b)!;
    if (group.length === 0) continue;
    const examples = group
      .slice(0, 3)
      .map((o) => `${o.label} [${truncate(o.yaml, 40)}]`)
      .join(", ");
    console.log(`    ${BUCKET_LABEL[b].padEnd(38)} ${String(group.length).padStart(4)}   e.g. ${examples}`);
  }
  console.log();

  if (dumpExamples) {
    const failing = allOutcomes.filter((o) => !o.pass);
    console.log(`  full failing list (${failing.length}):`);
    for (const o of failing) {
      console.log(`    [${BUCKET_LABEL[o.bucket]}] ${o.label} — ${o.detail}`);
    }
    console.log();
  } else {
    console.log("  (pass --dump-examples to print the full failing list)");
    console.log();
  }
}

/**
 * The real `yaml` library reports various non-fatal conditions (unresolved
 * tags, ambiguous anchors, Map-as-object coercion, …) via `process.emitWarning`
 * (falling back to `console.warn` only if that's unavailable) — irrelevant to
 * whether a VALUE came back, since we already capture success/throw/value
 * independently of these. Left unsuppressed, a few hundred of them (each
 * multi-line, with a caret-annotated snippet) drown the actual report in a
 * terminal. Scoped to just the comparison work below, never to a thrown-error
 * path, and always restored.
 */
function withSuppressedWarnings<T>(fn: () => T): T {
  const originalWarn = console.warn;
  const originalEmitWarning = process.emitWarning;
  console.warn = () => {};
  process.emitWarning = () => {};
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
    process.emitWarning = originalEmitWarning;
  }
}

function main(): void {
  const dumpExamples = process.argv.includes("--dump-examples");

  const curated: SourceCase[] = CORPUS.map((c) => ({ label: c.name, yaml: c.yaml, explicitBucket: c.bucket }));

  const suiteDir = fileURLToPath(new URL("../yaml-test-suite/data", import.meta.url));
  let suite: SourceCase[] = [];
  if (existsSync(suiteDir)) {
    suite = loadSuite(suiteDir).map((tc) => ({ label: `suite:${tc.id}`, yaml: tc.yaml }));
  } else {
    console.log(`(bench/yaml-test-suite/data not found — skipping the yaml-test-suite breadth fold-in; run "pnpm gen:suite" to include it)`);
    console.log();
  }

  console.log("Drop-in compat shim differential report");
  console.log("========================================");
  console.log(`Curated corpus: ${curated.length} cases.  yaml-test-suite fold-in: ${suite.length} cases (read-side breadth only).`);
  console.log();

  withSuppressedWarnings(() => {
    printSection(
      "js-yaml-compat",
      "js-yaml",
      curated,
      suite,
      (c) => compareRead(shimJsYamlLoad, (s) => jsYamlRealLoad(s), c),
      (c) => compareDump(shimJsYamlDump, (s) => jsYamlRealLoad(s), (v) => jsYamlRealDump(v), c),
      dumpExamples,
    );

    printSection(
      "yaml-compat",
      "yaml",
      curated,
      suite,
      (c) => compareRead(shimYamlParse, (s) => yamlRealParse(s), c),
      (c) => compareDump(shimYamlStringify, (s) => yamlRealParse(s), (v) => yamlRealStringify(v), c),
      dumpExamples,
    );
  });
}

main();
