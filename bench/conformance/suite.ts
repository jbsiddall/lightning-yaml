/**
 * Loader for the vendored yaml-test-suite (see ../yaml-test-suite/fetch.sh).
 *
 * Layout (verified against the `data-2022-01-17` snapshot — see fetch.sh):
 *   bench/yaml-test-suite/data/
 *     229Q/            — a "flat" test case: in.yaml directly inside.
 *       ===             (description, one line)
 *       in.yaml         (input — always present for a real case)
 *       in.json         (expected value(s), JSON text; MAY hold several
 *                        concatenated JSON values for a multi-document input)
 *       out.yaml        (canonical re-emission; unused here)
 *       test.event      (event stream; unused here)
 *       error           (present, possibly empty, iff the input MUST error)
 *     2G84/            — a "nested" test case: no in.yaml of its own, instead
 *       00/ 01/ 02/ …    numbered subdirs (zero-padding width varies, e.g.
 *                        "00".."08" or "000".."010"), each laid out exactly
 *                        like a flat case above.
 *     name/            — NOT a test case: a directory of symlinks from
 *                        human-readable names to the 4-char test IDs.
 *     tags/            — NOT a test case: tag -> test ID symlinks, one
 *                        sub-directory per tag.
 *
 * We don't special-case "name"/"tags" by hardcoded name — we detect a real
 * test case structurally (has its own `in.yaml`, or has at least one
 * all-digit subdirectory that itself has `in.yaml`) and skip anything else.
 * That's also what makes this robust to future snapshots adding/renaming
 * bookkeeping directories.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type CaseKind = "positive" | "negative" | "unscorable";

export interface TestCase {
  /** e.g. "229Q" for a flat case, "2G84/00" for a nested sub-case. */
  id: string;
  /** Absolute path to the case's own directory (containing in.yaml etc.). */
  dir: string;
  /** One-line human description from the `===` file ("" if missing). */
  description: string;
  /** Raw contents of in.yaml. */
  yaml: string;
  kind: CaseKind;
  /**
   * Ordered expected JS values for a positive case (one per document in
   * in.json). Undefined for negative/unscorable cases.
   */
  expected?: unknown[];
}

/** A directory name made up entirely of digits — "00", "01", "000", … */
function isNumberedDir(name: string): boolean {
  return /^[0-9]+$/.test(name);
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * Small depth/string-aware splitter for a `in.json` file that may hold
 * several concatenated JSON values (one per document), pretty-printed with
 * no separator other than whitespace. Cannot use JSON.parse directly (it
 * only accepts a single value) or naive line-splitting (values span many
 * lines and may contain braces/brackets inside strings).
 *
 * Scans top-level values one at a time: skips leading whitespace, then finds
 * the end of the next value by tracking bracket depth and string state (with
 * backslash-escape awareness) for `{`/`[`, matching quotes for `"`, or
 * scanning to the next whitespace for a bare scalar (number/true/false/null).
 * Each located slice is handed to the real `JSON.parse` for the actual
 * decoding, so we only need to find boundaries, not reimplement JSON.
 */
export function readJsonStream(text: string): unknown[] {
  const values: unknown[] = [];
  const n = text.length;
  const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
  let i = 0;

  while (i < n) {
    while (i < n && isWs(text[i]!)) i++;
    if (i >= n) break;

    const start = i;
    const c = text[i]!;

    if (c === "{" || c === "[") {
      const open = c;
      const close = c === "{" ? "}" : "]";
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (; i < n; i++) {
        const ch = text[i]!;
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') {
          inStr = true;
        } else if (ch === open) {
          depth++;
        } else if (ch === close) {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
    } else if (c === '"') {
      i++;
      let esc = false;
      for (; i < n; i++) {
        const ch = text[i]!;
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') {
          i++;
          break;
        }
      }
    } else {
      // Bare scalar (number/true/false/null): no braces/brackets/quotes, so
      // it always ends at the next whitespace (or EOF).
      while (i < n && !isWs(text[i]!)) i++;
    }

    values.push(JSON.parse(text.slice(start, i)));
  }

  return values;
}

/** Build a TestCase from a directory that is known to contain in.yaml. */
function buildCase(id: string, dir: string): TestCase {
  const yaml = readFileSync(join(dir, "in.yaml"), "utf8");
  const description = (readIfExists(join(dir, "===")) ?? "").trim();

  const inJsonText = readIfExists(join(dir, "in.json"));
  if (inJsonText !== undefined) {
    return { id, dir, description, yaml, kind: "positive", expected: readJsonStream(inJsonText) };
  }

  const hasError = existsSync(join(dir, "error"));
  if (hasError) {
    return { id, dir, description, yaml, kind: "negative" };
  }

  return { id, dir, description, yaml, kind: "unscorable" };
}

/**
 * Load every test case from a vendored yaml-test-suite data directory,
 * flattening nested (numbered-subdir) cases into the same list as flat ones.
 * Never throws on a directory that turns out not to be a real case (missing
 * in.yaml at every level) — it's just skipped.
 */
export function loadSuite(dataDir: string): TestCase[] {
  const cases: TestCase[] = [];

  const topEntries = readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const name of topEntries) {
    const dir = join(dataDir, name);

    if (existsSync(join(dir, "in.yaml"))) {
      cases.push(buildCase(name, dir));
      continue;
    }

    const subEntries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isNumberedDir(e.name))
      .map((e) => e.name)
      .sort();

    for (const sub of subEntries) {
      const subDir = join(dir, sub);
      if (existsSync(join(subDir, "in.yaml"))) {
        cases.push(buildCase(`${name}/${sub}`, subDir));
      }
      // A numbered subdir without its own in.yaml is not a real sub-case —
      // skip it rather than crashing.
    }
    // A top-level entry with neither its own in.yaml nor any numbered
    // subdir containing one (e.g. "name/", "tags/") is not a test case —
    // skip it silently.
  }

  return cases;
}
