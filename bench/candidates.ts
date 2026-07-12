/**
 * The benchmark candidates, behind a common interface so the speed and memory
 * harnesses can iterate over them without special-casing. Single source of
 * truth — when a `lightning-yaml` parser exists, add it here with group "ours"
 * and it appears in every benchmark automatically.
 *
 * Candidates are grouped so the two report cadences target different sets:
 *  - "baseline"    — JSON, the target we measure everything against (always run, fast).
 *  - "competition" — the leading JS YAML parsers we're trying to beat.
 *  - "ours"        — this repo's own parser (none yet).
 */

import { load as jsYamlLoad, dump as jsYamlDump } from "js-yaml";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export type Group = "baseline" | "competition" | "ours";

export type Scope = "all" | "competition" | "ours";

export interface Candidate {
  /** Display name used in benchmark output. */
  name: string;
  group: Group;
  /** Parse a text document into a JS value. */
  parse: (text: string) => unknown;
  /** Serialize a JS value back to text. */
  stringify: (value: unknown) => string;
}

export const candidates: Candidate[] = [
  {
    name: "JSON",
    group: "baseline",
    parse: (text) => JSON.parse(text),
    stringify: (value) => JSON.stringify(value),
  },
  {
    name: "js-yaml",
    group: "competition",
    parse: (text) => jsYamlLoad(text),
    stringify: (value) => jsYamlDump(value),
  },
  {
    name: "yaml",
    group: "competition",
    parse: (text) => yamlParse(text),
    stringify: (value) => yamlStringify(value),
  },
  // When lightning-yaml exists, add it here:
  // { name: "lightning-yaml", group: "ours", parse: ..., stringify: ... },
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
