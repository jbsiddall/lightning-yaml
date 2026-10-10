import fc from "fast-check";
import { z } from "zod";
import { ZodFastCheck } from "zod-fast-check";
import { encodeGraph } from "./graph.js";
import type { CaseDescriptor, OptionRecipe, Operation } from "./types.js";

const zfc = ZodFastCheck();
const scalar = zfc.inputOf(
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    "a: 1\nb: true\n",
    "[1, 2, {x: y}]",
    "---\na\n---\nb\n",
    "x: [1, 2",
    "&a [*a]",
    'value: "a\nb"\n',
    "|\n  block text\n",
    " folded\n  text\n",
    "%YAML 1.2\n---\na: yes\n",
    "!thing value\n",
    "a: 1\n---\nb: 2\n",
    'key: "unterminated\n',
    "a: *missing\n",
  ),
  fc
    .array(scalar, { maxLength: 8 })
    .map((xs) => `items: [${xs.map((x) => JSON.stringify(x)).join(", ")}]\n`),
  fc.string({ maxLength: 96 }).map((s) => `value: ${JSON.stringify(s)}\n`),
);
// Container depth is explicitly capped at two; scalar generation comes from zod-fast-check.
export const graphArb: fc.Arbitrary<unknown> = fc.oneof(
  scalar,
  fc.array(scalar, { maxLength: 6 }),
  fc.dictionary(fc.string({ maxLength: 12 }), scalar, { maxKeys: 6 }),
  fc.dictionary(
    fc.string({ maxLength: 12 }),
    fc.array(scalar, { maxLength: 4 }),
    { maxKeys: 5 },
  ),
  fc.array(fc.dictionary(fc.string({ maxLength: 8 }), scalar, { maxKeys: 4 }), {
    maxLength: 4,
  }),
);
export function generatedLoad(seed: number, count: number): CaseDescriptor[] {
  return fc
    .sample(textArb, { seed, numRuns: count })
    .map((text, i) => ({
      id: `gen-load-${i}`,
      operation: "load",
      text,
      options: { values: {} },
      source: "generated-grammar",
      categories: ["generated"],
      seed,
    }));
}
export function generatedDumps(seed: number, count: number): CaseDescriptor[] {
  return fc
    .sample(graphArb, { seed: seed ^ 0x5f3759df, numRuns: count })
    .map((value, i) => ({
      id: `gen-dump-${i}`,
      operation: "dump",
      graph: encodeGraph(value),
      options: { values: {} },
      source: "generated-graph",
      categories: ["generated"],
      seed,
    }));
}
export const booleanDumpKeys = [
  "seqNoIndent",
  "seqInlineFirst",
  "sortKeys",
  "flowBracketPadding",
  "flowSkipCommaSpace",
  "flowSkipColonSpace",
  "quoteFlowKeys",
  "forceQuotes",
  "tagBeforeAnchor",
  "skipInvalid",
  "noRefs",
] as const;
export function fullBooleanBasis(): OptionRecipe[] {
  const out: OptionRecipe[] = [];
  const total = 2 ** booleanDumpKeys.length * 2;
  for (let index = 0; index < total; index++) {
    let n = Math.floor(index / 2);
    const values: Record<string, unknown> = {};
    for (const key of booleanDumpKeys) {
      values[key] = n % 2 === 1;
      n = Math.floor(n / 2);
    }
    values.quoteStyle = index % 2 === 0 ? "single" : "double";
    out.push({ values });
  }
  return out;
}
export function singleOptionWitnesses(): Array<{
  operation: Operation;
  options: OptionRecipe;
}> {
  const result: Array<{ operation: Operation; options: OptionRecipe }> = [];
  const add = (
    operation: Operation,
    key: string,
    value: unknown,
    explicitUndefined = false,
  ) =>
    result.push({
      operation,
      options: {
        values: value === undefined ? {} : { [key]: value },
        ...(explicitUndefined ? { undefinedKeys: [key] } : {}),
      },
    });
  for (const value of [undefined, "", "settings.yaml", "設定.yaml"])
    add("load", "filename", value, value === undefined);
  for (const value of [undefined, false, true])
    add("load", "json", value, value === undefined);
  for (const key of ["maxDepth", "maxAliases", "maxTotalMergeKeys"])
    for (const value of [undefined, -1, 0, 1, 2, 4])
      add("load", key, value, value === undefined);
  for (const schema of [
    "default",
    "failsafe",
    "json",
    "core",
    "yaml11",
  ] as const) {
    result.push(
      { operation: "load", options: { values: {}, schema } },
      { operation: "dump", options: { values: {}, schema } },
    );
  }
  for (const key of booleanDumpKeys)
    for (const value of [undefined, false, true])
      add("dump", key, value, value === undefined);
  for (const value of [undefined, -1, 0, 1, 2])
    add("dump", "indent", value, value === undefined);
  for (const value of [undefined, -1, 0, 1, 80])
    add("dump", "lineWidth", value, value === undefined);
  for (const value of [undefined, -1, 0, 1])
    add("dump", "flowLevel", value, value === undefined);
  for (const value of [undefined, "single", "double"])
    add("dump", "quoteStyle", value, value === undefined);
  for (const callback of ["sort-asc", "sort-desc"] as const)
    result.push({ operation: "dump", options: { values: {}, callback } });
  for (const callback of ["identity", "mutate", "throw"] as const)
    result.push({ operation: "dump", options: { values: {}, callback } });
  return result;
}
