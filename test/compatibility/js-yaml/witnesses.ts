import { encodeGraph } from "../shared/graph.js";
import { schemaIds } from "./options.js";
import type { CaseDescriptor, OptionRecipe } from "./types.js";

export function behaviorWitnesses(): CaseDescriptor[] {
  const cases: CaseDescriptor[] = [];
  const parse = (family: string, text: string, options: OptionRecipe[]) => {
    options.forEach((recipe, index) =>
      cases.push({
        id: `behavior-${family}-${index}`,
        operation: "load",
        text,
        options: recipe,
        source: `option-behavior/${family}`,
        categories: ["option-behavior", family],
      }),
    );
  };
  parse(
    "filename",
    "key: [\n",
    ["", "example.yaml", "設定.yaml"].map((filename) => ({
      values: { filename },
    })),
  );
  parse("json", "key: 1\nkey: 2\n", [
    { values: {} },
    { values: { json: false } },
    { values: { json: true } },
    { values: {}, undefinedKeys: ["json"] },
  ]);
  parse(
    "maxDepth",
    "value: [[[[[1]]]]]\n",
    [0, 1, 4, 5, 6, 100].map((maxDepth) => ({ values: { maxDepth } })),
  );
  parse(
    "maxAliases",
    "base: &base [1, 2]\ncopies: [*base, *base, *base]\n",
    [-1, 0, 1, 2, 4].map((maxAliases) => ({ values: { maxAliases } })),
  );
  parse(
    "maxTotalMergeKeys",
    "base: &base {a: 1, b: 2}\ncopy: {<<: *base, c: 3}\n",
    [-1, 0, 1, 2, 3].map((maxTotalMergeKeys) => ({
      values: { maxTotalMergeKeys },
    })),
  );
  parse(
    "schema",
    "boolean: yes\nnumber: 012\nnan: .NaN\ndate: 2001-12-14\nempty: null\n",
    schemaIds.map((schema) => ({ values: {}, schema })),
  );
  const shared = { value: "quoted: value", sequence: [1, 2] };
  const graph = encodeGraph({
    z: "x ".repeat(90),
    a: [shared, shared],
    "key with spaces": "it's quoted",
  });
  const dumpOptions: OptionRecipe[] = [
    ...[1, 2, 4].map((indent) => ({ values: { indent } })),
    ...[-1, 1, 20, 80].map((lineWidth) => ({ values: { lineWidth } })),
    ...[-1, 0, 1, 2].map((flowLevel) => ({ values: { flowLevel } })),
    { values: { noRefs: false } },
    { values: { noRefs: true } },
    ...schemaIds.map((schema) => ({ values: {}, schema })),
  ];
  dumpOptions.forEach((options, index) =>
    cases.push({
      id: `behavior-dump-${index}`,
      operation: "dump",
      graph,
      options,
      source: "option-behavior/dump",
      categories: ["option-behavior", "format-and-reference"],
    }),
  );
  for (const [fixture, value] of [
    ["simple", { value: "hello" }],
    ["multiline", { value: "line one\nline two\n" }],
  ] as const)
    for (const scalarStyleRules of [
      "default",
      "double-quoted-values",
      "throw",
    ] as const)
      cases.push({
        id: `behavior-scalar-style-${fixture}-${scalarStyleRules}`,
        operation: "dump",
        graph: encodeGraph(value),
        options: { values: {}, scalarStyleRules },
        source: "option-behavior/scalarStyleRules",
        categories: ["option-behavior", "scalar-style-rules", fixture],
      });
  for (const skipInvalid of [false, true])
    cases.push({
      id: `behavior-invalid-${skipInvalid}`,
      operation: "dump",
      valueRecipe: "mixed-invalid",
      options: { values: { skipInvalid } },
      source: "option-behavior/skipInvalid",
      categories: ["option-behavior", "invalid-values"],
    });
  return cases;
}
