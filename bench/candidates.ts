/**
 * The three benchmark candidates, behind a common interface so the speed and
 * memory harnesses can iterate over them without special-casing. Single source
 * of truth — add a future `lightning-yaml` implementation here and it shows up
 * in every benchmark automatically.
 */

import { load as jsYamlLoad, dump as jsYamlDump } from "js-yaml";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export interface Candidate {
  /** Display name used in benchmark output. */
  name: string;
  /** Parse a text document into a JS value. */
  parse: (text: string) => unknown;
  /** Serialize a JS value back to text. */
  stringify: (value: unknown) => string;
}

export const candidates: Candidate[] = [
  {
    name: "JSON",
    parse: (text) => JSON.parse(text),
    stringify: (value) => JSON.stringify(value),
  },
  {
    name: "js-yaml",
    parse: (text) => jsYamlLoad(text),
    stringify: (value) => jsYamlDump(value),
  },
  {
    name: "yaml",
    parse: (text) => yamlParse(text),
    stringify: (value) => yamlStringify(value),
  },
];

export function candidateByName(name: string): Candidate {
  const found = candidates.find((c) => c.name === name);
  if (!found) throw new Error(`Unknown candidate: ${name}`);
  return found;
}
