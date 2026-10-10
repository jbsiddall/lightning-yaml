// One manifest drives profile scheduling, completeness checks, and preflight.
// Inputs are bounded and deterministic; neither set changes the 13 × 2 gate.
export const facadeDatasets = ["small-records", "yaml-plain-medium-records"];
export const diagnosticInputs = [
  ["supplementary", `value: "🚀"\n`],
  ["lone-surrogate", `value: "\\uD800"\n`],
  ["unescaped-longquotes", `value: '${'"'.repeat(2048)}'\n`],
  ["escaped-longquotes", `value: "${'\\"'.repeat(2048)}"\n`],
  ["blockscalar", `value: |\n${"  payload line with text\n".repeat(384)}`],
  ["alias-cycle", `value: &cycle [*cycle]\n`],
  ["repeated-keys", Array.from({ length: 256 }, (_, i) => `- alpha: ${i}\n  beta: shared\n  gamma: true`).join("\n") + "\n"],
  ["unique-keys", Array.from({ length: 256 }, (_, i) => `key${String(i).padStart(4, "0")}: ${i}`).join("\n") + "\n"],
].map(([name, text]) => ({ name, text, options: {} }));

export function sourceProfileKeys() {
  const keys = [];
  for (const dataset of ["small-records", "medium-records", "yaml-plain-medium-records", "yaml-rich-medium"]) {
    for (const profile of ["native.parse", "native.parseAll", "native.strictParse", "native.strictParseAll"]) {
      keys.push(`${profile} · ${dataset}`);
    }
  }
  for (const dataset of ["medium-records", "yaml-plain-medium-records"]) {
    for (const profile of ["native.internStrings", "native.smallKeyCache", "yamlCompat.parse", "yamlCompat.parseAllDocuments", "jsYamlCompat.load", "jsYamlCompat.loadAll", "native.stringify", "yamlCompat.stringify", "jsYamlCompat.dump"]) {
      keys.push(`${profile} · ${dataset}`);
    }
  }
  for (const { name } of diagnosticInputs) keys.push(`diagnostic.parse · ${name}`);
  return keys;
}

export function builtProfileKeys() {
  const keys = [];
  for (const format of ["esm", "cjs"]) {
    for (const dataset of facadeDatasets) {
      for (const operation of ["parse", "stringify"]) keys.push(`built.${format}.${operation} · ${dataset}`);
    }
  }
  return keys;
}
