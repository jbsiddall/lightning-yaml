/**
 * Validate benchmark YAML against the per-suite zod schemas (bench/schemas.ts).
 *
 *   node --import tsx bench/validate.ts <file.yaml> [<file.yaml> ...]
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseAllDocuments } from "yaml";
import { SUITE_SCHEMAS, type SuiteName } from "./schemas.ts";

const SUITE_NAMES = Object.keys(SUITE_SCHEMAS) as SuiteName[];

function isSuiteName(s: string): s is SuiteName {
  return (SUITE_NAMES as string[]).includes(s);
}

function suiteFromStem(file: string): SuiteName | undefined {
  const stem = basename(file).replace(/\.ya?ml$/i, "");
  return isSuiteName(stem) ? stem : undefined;
}

interface Failure {
  file: string;
  /** Document index, or -1 for a whole-file problem (e.g. empty stream). */
  doc: number;
  message: string;
}

function declaredSuite(js: unknown): SuiteName | undefined {
  if (js === null || typeof js !== "object") return undefined;
  const s = (js as Record<string, unknown>).suite;
  return typeof s === "string" && isSuiteName(s) ? s : undefined;
}

function validateFile(file: string, failures: Failure[]): number {
  const parsed = parseAllDocuments(readFileSync(file, "utf8"));
  if (parsed.length === 0) {
    failures.push({ file, doc: -1, message: "empty stream — no YAML documents found" });
    return 0;
  }
  const stemSuite = suiteFromStem(file);
  parsed.forEach((doc, i) => {
    if (doc.errors.length > 0) {
      failures.push({ file, doc: i, message: `YAML parse error: ${doc.errors[0]?.message}` });
      return;
    }
    const js: unknown = doc.toJS({ maxAliasCount: -1 });
    const suite = declaredSuite(js) ?? stemSuite;
    if (!suite) {
      failures.push({ file, doc: i, message: "cannot determine suite (no valid `suite` field, unrecognized filename)" });
      return;
    }
    const res = SUITE_SCHEMAS[suite].safeParse(js);
    if (!res.success) {
      const detail = res.error.issues
        .map((iss) => `      ${iss.path.length ? iss.path.join(".") : "(root)"}: ${iss.message}`)
        .join("\n");
      failures.push({ file, doc: i, message: `[${suite}] schema validation failed:\n${detail}` });
    }
  });
  return parsed.length;
}

function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node --import tsx bench/validate.ts <file.yaml> [<file.yaml> ...]");
    process.exit(1);
  }

  const failures: Failure[] = [];
  let filesValidated = 0;
  let filesSkipped = 0;
  let docsValidated = 0;

  for (const file of files) {
    if (!existsSync(file)) {
      console.warn(`! skipping ${file} — no such file`);
      filesSkipped++;
      continue;
    }
    const docs = validateFile(file, failures);
    filesValidated++;
    docsValidated += docs;
    console.log(`  ${file}: ${docs} document(s)`);
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} validation failure(s):`);
    for (const f of failures) {
      const where = f.doc < 0 ? f.file : `${f.file} · doc[${f.doc}]`;
      console.error(`  ${where}: ${f.message}`);
    }
    process.exit(1);
  }

  const skippedNote = filesSkipped ? ` (${filesSkipped} missing file(s) skipped)` : "";
  console.log(`\n✓ validated ${docsValidated} document(s) across ${filesValidated} file(s)${skippedNote}.`);
}

main();
