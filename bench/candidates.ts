/**
 * The benchmark candidates, behind a common interface so the speed and memory
 * harnesses can iterate over them without special-casing. Single source of
 * truth — a candidate registered here appears in every benchmark and (for the
 * "ours" group) in the consistency tests automatically.
 *
 * Candidates are grouped so the two report cadences target different sets:
 *  - "baseline"    — JSON, the target we measure everything against (always run, fast).
 *  - "competition" — the leading JS YAML parsers we're trying to beat.
 *  - "ours"        — this repo's own parser (a stub for now; see src/index.ts).
 *
 * Each candidate also declares a `kind`:
 *  - "json" — only handles JSON-compatible text/values (JSON.parse can't read
 *    block YAML, and JSON.stringify can't represent `!!binary`/shared refs).
 *  - "yaml" — handles the full YAML surface.
 * `candidateApplies` uses `kind` + the dataset category to decide which
 * candidates run for parse vs. stringify.
 */

import { createRequire } from "node:module";
import { load as jsYamlLoad, dump as jsYamlDump, CORE_SCHEMA, YAML11_SCHEMA } from "js-yaml";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { parse as ourParse, stringify as ourStringify, NotImplementedError } from "../src/index.ts";
import type { Category, DatasetDef } from "./fixtures/datasets.ts";

export type Group = "baseline" | "competition" | "ours";

export type Scope = "all" | "competition" | "ours";

export type Op = "parse" | "stringify";

/** What kind of input a candidate can handle. */
export type Kind = "json" | "yaml";

export interface Candidate {
  /** Display name used in benchmark output. */
  name: string;
  group: Group;
  kind: Kind;
  /**
   * Parse a text document into a JS value. Receives the fixture's `category` so
   * a candidate can select a category-appropriate config without sniffing the
   * text: js-yaml needs the YAML 1.1 schema to read `!!binary` in the rich
   * fixtures, but keeps its leaner 1.2-core default for JSON-shaped input. Most
   * candidates ignore the argument.
   */
  parse: (text: string, category?: Category) => unknown;
  /**
   * Serialize a JS value back to text. Optional: a candidate may implement only
   * `parse` (lightning-yaml ships parse first; its dumper is a later milestone).
   * The stringify speed/memory benches and the consistency suite skip candidates
   * without one — we do NOT substitute a foreign serializer (e.g. JSON.stringify)
   * for a candidate that hasn't written its own, which would report the wrong
   * library's numbers under this candidate's name.
   */
  stringify?: (value: unknown) => string;
  /**
   * Ops this candidate runs (default: both). The `js-yaml (tuned)` row is
   * stringify-only — it exists to show js-yaml's dump speed under a leaner
   * schema, not to duplicate its parse row (where schema barely moves the
   * needle, ~a few % within noise).
   */
  ops?: readonly Op[];
  /**
   * Fixture categories this candidate runs on (default: everything its `kind`
   * allows). The tuned row is limited to JSON-shaped data (`json`,
   * `yaml-plain`) — the only place a smaller-than-default dump schema is both
   * valid and faster; `yaml-rich` needs the full schema, where "tuned" would
   * just equal the default row.
   */
  categories?: readonly Category[];
}

/**
 * js-yaml v5's default LOAD schema is CORE (YAML 1.2 core), which — correctly
 * for 1.2 — does not define `!!binary` (a 1.1 tag). Our rich fixtures use
 * `!!binary`, so js-yaml needs the YAML 1.1 schema to read them; JSON-shaped
 * input keeps the leaner default. Without this, js-yaml threw on every rich
 * fixture and `candidateHandles` silently dropped it from the rich parse rows —
 * even though it parses them fine when asked with the right schema. (The `yaml`
 * oracle and lightning-yaml both read `!!binary` out of the box.)
 */
const jsYamlParse = (text: string, category?: Category): unknown =>
  jsYamlLoad(text, category === "yaml-rich" ? { schema: YAML11_SCHEMA } : undefined);

export const candidates: Candidate[] = [
  {
    name: "JSON",
    group: "baseline",
    kind: "json",
    parse: (text) => JSON.parse(text),
    stringify: (value) => JSON.stringify(value),
  },
  {
    name: "js-yaml",
    group: "competition",
    kind: "yaml",
    parse: jsYamlParse,
    stringify: (value) => jsYamlDump(value),
  },
  {
    // A second js-yaml row: same library, dumped with the lean CORE schema
    // instead of js-yaml's heavyweight default (YAML 1.1 + timestamp/binary/
    // omap/set). On JSON-shaped data that is ~1.3–1.5× faster and round-trips
    // identically — what a speed-aware js-yaml user would configure. It is
    // stringify-only and JSON-shaped-only: on rich data the full schema is
    // required, where "tuned" would just equal the default row.
    name: "js-yaml-tuned",
    group: "competition",
    kind: "yaml",
    parse: jsYamlParse,
    stringify: (value) => jsYamlDump(value, { schema: CORE_SCHEMA }),
    ops: ["stringify"],
    categories: ["json", "yaml-plain"],
  },
  {
    name: "yaml",
    group: "competition",
    kind: "yaml",
    // maxAliasCount: -1 disables `yaml`'s default 100-alias DoS guard so it can
    // parse our (trusted) anchor-heavy rich fixtures; js-yaml has no such guard.
    parse: (text) => yamlParse(text, { maxAliasCount: -1 }),
    stringify: (value) => yamlStringify(value),
  },
  {
    name: "lightning-yaml",
    group: "ours",
    kind: "yaml",
    parse: (text) => ourParse(text),
    stringify: (value) => ourStringify(value),
  },
];

/** Candidates in a given group. */
export function candidatesInGroup(group: Group): Candidate[] {
  return candidates.filter((c) => c.group === group);
}

/**
 * Candidates for a report scope. The baseline (JSON) is always included as the
 * reference for ratios:
 *  - "all"         → baseline + competition + ours (every candidate)
 *  - "competition" → baseline + competition
 *  - "ours"        → baseline + ours
 */
export function selectCandidates(scope: Scope): Candidate[] {
  const baseline = candidatesInGroup("baseline");
  if (scope === "competition") return [...baseline, ...candidatesInGroup("competition")];
  if (scope === "ours") return [...baseline, ...candidatesInGroup("ours")];
  return candidates;
}

/** Scope from the BENCH_SCOPE env var (defaults to "all"). */
export function scopeFromEnv(): Scope {
  const s = process.env.BENCH_SCOPE;
  return s === "competition" || s === "ours" ? s : "all";
}

export function candidateByName(name: string): Candidate {
  const found = candidates.find((c) => c.name === name);
  if (!found) throw new Error(`Unknown candidate: ${name}`);
  return found;
}

/** Display label per candidate name — the single source every benchmark-YAML emitter shares. */
const DISPLAY_LABEL: Record<string, string> = {
  JSON: "JSON",
  "js-yaml": "js-yaml",
  "js-yaml-tuned": "js-yaml (tuned)",
  yaml: "yaml (eemeli)",
  "lightning-yaml": "Lightning YAML",
};

const require = createRequire(import.meta.url);

/** A package's installed version, or undefined if it can't be resolved (so a lookup never throws). */
function pkgVersion(specifier: string): string | undefined {
  try {
    return (require(specifier) as { version: string }).version;
  } catch {
    return undefined;
  }
}

/**
 * The package.json each candidate's `version` comes from. js-yaml-tuned is the
 * same js-yaml package under a leaner dump schema, so it reports js-yaml's
 * version; lightning-yaml is bundled from src/, not an installed dep, so its
 * version is the repo-root package.json (resolved relative to this file). JSON is
 * built into the runtime — no package, so it never carries a version.
 */
const VERSION: Record<string, string | undefined> = {
  "js-yaml": pkgVersion("js-yaml/package.json"),
  "js-yaml-tuned": pkgVersion("js-yaml/package.json"),
  yaml: pkgVersion("yaml/package.json"),
  "lightning-yaml": pkgVersion("../package.json"),
};

/** Display metadata for a candidate, as it appears in a benchmark YAML doc's `libraries` list. */
export interface LibraryMeta {
  id: string;
  label: string;
  baseline?: boolean;
  self?: boolean;
  version?: string;
}

export function libraryMeta(c: Candidate): LibraryMeta {
  const m: LibraryMeta = { id: c.name, label: DISPLAY_LABEL[c.name] ?? c.name };
  if (c.group === "baseline") m.baseline = true;
  if (c.group === "ours") m.self = true;
  const v = VERSION[c.name];
  if (v) m.version = v;
  return m;
}

/**
 * The `scope` field written into a benchmark YAML doc. "all" (every
 * candidate) IS the head-to-head competition run, so both fold to the same
 * label — only "ours" (JSON + lightning-yaml, partial matrix) is distinct.
 */
export function scopeLabel(scope: Scope): "competition" | "ours" {
  return scope === "ours" ? "ours" : "competition";
}

/**
 * Whether `candidate` should run for `op` on a fixture of `category`.
 *
 * A candidate may narrow itself with `ops`/`categories` (the tuned js-yaml row
 * does both) — those gates apply first. Otherwise: YAML candidates handle
 * everything; a JSON candidate:
 *  - "json"       → yes (pure JSON text, JSON-compatible value);
 *  - "yaml-plain" → stringify only (the value is JSON-compatible, so JSON is a
 *    valid stringify baseline — but JSON.parse can't read block YAML);
 *  - "yaml-rich"  → never (can't parse block YAML, and can't represent the
 *    `!!binary`/shared-ref value).
 */
export function candidateApplies(candidate: Candidate, category: Category, op: Op): boolean {
  if (candidate.ops && !candidate.ops.includes(op)) return false;
  if (candidate.categories && !candidate.categories.includes(category)) return false;
  if (candidate.kind === "yaml") return true;
  if (category === "json") return true;
  if (category === "yaml-plain") return op === "stringify";
  return false; // yaml-rich
}

/** Convenience overload keyed on a dataset. */
export function candidateAppliesTo(candidate: Candidate, ds: DatasetDef, op: Op): boolean {
  return candidateApplies(candidate, ds.category, op);
}

/**
 * Whether a candidate actually implements `op` yet. A candidate may omit
 * `stringify` entirely (lightning-yaml does, for now) — that's an honest "not
 * supported", not a crash. lightning-yaml's `parse` stub throws
 * `NotImplementedError`; the benchmarks skip candidates that aren't ready rather
 * than crashing (mitata can't benchmark a throwing function). Any other error is
 * treated as "implemented but broken" — surfaced, not swallowed.
 */
export function candidateSupports(candidate: Candidate, op: Op): boolean {
  if (op === "stringify" && !candidate.stringify) return false;
  try {
    if (op === "parse") candidate.parse("null");
    else candidate.stringify!(null);
    return true;
  } catch (err) {
    return !(err instanceof NotImplementedError);
  }
}

/**
 * Whether `candidate` can actually process this *specific* fixture without
 * throwing. `candidateSupports` answers "is this op implemented at all" with a
 * one-token canary; this answers "does it handle THIS input", which differs
 * while a parser is partial: lightning-yaml reads flow/JSON before it reads
 * block YAML, so we benchmark it only on the fixtures it genuinely handles today
 * rather than publishing an error row for input it can't read yet. This gates
 * only the *speed* benchmark's candidate list (the memory harness already skips
 * workers that fail); correctness is still enforced — loudly, no swallowing — by
 * the vitest consistency suite.
 */
export function candidateHandles(
  candidate: Candidate,
  op: Op,
  input: string | unknown,
  category?: Category,
): boolean {
  try {
    if (op === "parse") candidate.parse(input as string, category);
    else if (candidate.stringify) candidate.stringify(input);
    else return false;
    return true;
  } catch {
    return false;
  }
}
