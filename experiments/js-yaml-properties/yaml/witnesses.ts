import { encodeGraph } from "../graph.js";
import type { CaseDescriptor, Operation, OptionRecipe } from "./types.js";
import { inventories } from "./options.js";
const parseBooleans = [
  "intAsBigInt",
  "keepSourceTokens",
  "prettyErrors",
  "strict",
  "stringKeys",
  "uniqueKeys",
  "merge",
  "resolveKnownTags",
  "mapAsMap",
] as const;
const stringifyBooleans = [
  "aliasDuplicateObjects",
  "flow",
  "keepUndefined",
  "doubleQuotedAsJSON",
  "flowCollectionPadding",
  "indentSeq",
  "simpleKeys",
  "trailingComma",
  "verifyAliasOrder",
  "sortMapEntries",
] as const;
const base = (
  id: string,
  operation: Operation,
  options: OptionRecipe,
  text?: string,
  graph?: string,
): CaseDescriptor => ({
  id,
  operation,
  options,
  ...(text !== undefined ? { text } : {}),
  ...(graph !== undefined ? { graph } : {}),
  source: "finite-basis",
  categories: ["options", "matrix"],
});
export function finiteBases() {
  const parse: CaseDescriptor[] = [],
    stringify: CaseDescriptor[] = [],
    enumCases: CaseDescriptor[] = [];
  for (let n = 0; n < 2 ** parseBooleans.length; n++) {
    const values = Object.fromEntries(
      parseBooleans.map((k, i) => [k, Boolean(n & (1 << i))]),
    );
    parse.push(
      base(
        `parse-bool-${n}`,
        "parse",
        { values },
        "a: 1\nitems: [yes, null]\n",
      ),
    );
  }
  const value = encodeGraph({ z: ["long value", true], a: { b: null } });
  for (let n = 0; n < 2 ** stringifyBooleans.length; n++) {
    const values = Object.fromEntries(
      stringifyBooleans.map((k, i) => [k, Boolean(n & (1 << i))]),
    );
    stringify.push(
      base(`stringify-bool-${n}`, "stringify", { values }, undefined, value),
    );
  }
  const domains = {
    blockQuote: [false, true, "folded", "literal"],
    collectionStyle: ["any", "block", "flow"],
    singleQuote: [false, true, null],
    directives: [false, true, null],
  } as const;
  const keys = Object.keys(domains) as (keyof typeof domains)[];
  for (let n = 0; n < 108; n++) {
    let q = n;
    const values: Record<string, unknown> = {};
    for (const k of keys) {
      const a = domains[k] as readonly unknown[];
      values[k] = a[q % a.length];
      q = Math.floor(q / a.length);
    }
    enumCases.push(
      base(`stringify-enum-${n}`, "stringify", { values }, undefined, value),
    );
  }
  return { parse, stringify, enum: enumCases };
}
function add(
  out: CaseDescriptor[],
  op: Operation,
  key: string,
  value: unknown,
  suffix: string,
  fixture?: string,
): void {
  out.push(
    base(
      `${op}-${key}-${suffix}`,
      op,
      {
        values: value === undefined ? {} : { [key]: value },
        ...(value === undefined ? { undefinedKeys: [key] } : {}),
      },
      fixture ?? (op === "stringify" ? undefined : "a: 1\na: 2\n"),
      op === "stringify"
        ? encodeGraph({ a: 1, drop: 2, nested: { a: 3 } })
        : undefined,
    ),
  );
}
export function optionWitnesses(): CaseDescriptor[] {
  const out: CaseDescriptor[] = [];
  const parseVals: Record<string, unknown[]> = {
    intAsBigInt: [false, true],
    keepSourceTokens: [false, true],
    lineCounter: ["lineCounter"],
    prettyErrors: [false, true],
    strict: [false, true],
    stringKeys: [false, true],
    uniqueKeys: [false, true],
    logLevel: ["silent", "error", "warn", "debug"],
    version: ["1.1", "1.2", "next"],
    compat: [null],
    customTags: [null],
    merge: [false, true],
    resolveKnownTags: [false, true],
    schema: ["failsafe", "core", "json", "yaml-1.1"],
    sortMapEntries: [false, true],
    toStringDefaults: [{ indent: 4 }],
    mapAsMap: [false, true],
    maxAliasCount: [-1, 0, 1, 100],
  };
  for (const [key, vals] of Object.entries(parseVals)) {
    add(
      out,
      ["reviver", "mapAsMap", "maxAliasCount"].includes(key)
        ? "parse"
        : "parseDocument",
      key,
      undefined,
      "undefined",
    );
    for (const value of vals)
      add(
        out,
        key === "reviver" ||
          key === "onAnchor" ||
          key === "mapAsMap" ||
          key === "maxAliasCount"
          ? "parse"
          : "parseDocument",
        key,
        value,
        String(value),
        key === "maxAliasCount" ? "base: &x {v: 1}\na: *x\nb: *x\n" : undefined,
      );
  }
  const stringifyVals: Record<string, unknown[]> = {
    aliasDuplicateObjects: [false, true],
    anchorPrefix: ["a"],
    flow: [false, true],
    keepUndefined: [false, true],
    onTagObj: ["onTagObj"],
    tag: ["tag:yaml.org,2002:str"],
    blockQuote: [false, true, "folded", "literal"],
    collectionStyle: ["any", "block", "flow"],
    commentString: ["commentString"],
    defaultKeyType: ["PLAIN", "QUOTE_SINGLE"],
    defaultStringType: ["PLAIN", "BLOCK_LITERAL"],
    directives: [false, true, null],
    doubleQuotedAsJSON: [false, true],
    doubleQuotedMinMultiLineLength: [0, 1, 80],
    falseStr: ["no"],
    flowCollectionPadding: [false, true],
    indent: [-1, 0, 1, 2, 4, 8, 9],
    indentSeq: [false, true],
    lineWidth: [0, 1, 80],
    minContentWidth: [0, 1, 20],
    nullStr: ["nil"],
    simpleKeys: [false, true],
    singleQuote: [false, true, null],
    trailingComma: [false, true],
    trueStr: ["yes"],
    verifyAliasOrder: [false, true],
    schema: ["core", "yaml-1.1"],
    version: ["1.1", "1.2", "next"],
    customTags: [null],
    sortMapEntries: [false, true],
    resolveKnownTags: [false, true],
    merge: [false, true],
    uniqueKeys: [false, true],
    strict: [false, true],
    prettyErrors: [false, true],
    keepSourceTokens: [false, true],
    intAsBigInt: [false, true],
    stringKeys: [false, true],
    compat: [null],
    logLevel: ["silent", "warn"],
    _directives: ["directives"],
    toStringDefaults: [{ indent: 4 }],
  };
  for (const [key, vals] of Object.entries(stringifyVals)) {
    add(out, "stringify", key, undefined, "undefined");
    for (const value of vals) add(out, "stringify", key, value, String(value));
  }
  for (const [operation, key, callback] of [
    ["parse", "onAnchor", "onAnchor"],
    ["parse", "uniqueKeys", "uniqueKeys"],
    ["parse", "reviver", "reviver-delete"],
    ["parseDocument", "_directives", "directives"],
    ["stringify", "sortMapEntries", "sortMapEntries"],
    ["stringify", "onTagObj", "onTagObj"],
    ["stringify", "commentString", "commentString"],
    ["stringify", "customTags", "customTags"],
    ["stringify", "customTags", "customTags-array"],
  ] as const) {
    const options: OptionRecipe = { values: {}, callback };
    out.push(
      base(
        `callback-${operation}-${key}-${callback}`,
        operation,
        options,
        operation === "parse"
          ? callback === "uniqueKeys"
            ? "a: 1\na: 2\n"
            : callback === "reviver-delete"
              ? '{"keep":1,"drop":2}'
              : "base: &x {v: 1}\na: *x\nb: *x\n"
          : undefined,
        operation === "stringify" &&
          callback !== "commentString" &&
          callback !== "onTagObj"
          ? encodeGraph({ a: 1 })
          : undefined,
      ),
    );
    if (operation === "stringify" && callback === "commentString")
      out[out.length - 1]!.valueRecipe = "commented-document-input";
    if (operation === "stringify" && callback === "onTagObj") {
      out[out.length - 1]!.graph = undefined;
      out[out.length - 1]!.valueRecipe = "custom-value-input";
    }
  }
  return out;
}
export function behaviorWitnesses(): CaseDescriptor[] {
  const rows: CaseDescriptor[] = [];
  const texts: [string, string][] = [
    ["duplicate-keys", "a: 1\na: 2\n"],
    ["aliases", "base: &x {v: 1}\na: *x\nb: *x\n"],
    ["partial-stream", "---\na: 1\n---\n[broken\n---\nc: 3\n"],
    ["diagnostics", "a: *missing\n"],
    ["multi-doc-parse", "---\na: 1\n---\nb: 2\n"],
    ["special-tags", "date: !!timestamp 2020-01-01\nset: !!set {a: null}\n"],
  ];
  for (const [id, text] of texts)
    for (const operation of [
      "parse",
      "parseDocument",
      "parseAllDocuments",
    ] as const)
      rows.push(base(`${id}-${operation}`, operation, { values: {} }, text));
  for (const [id, valueRecipe] of [
    ["undefined-root", "undefined"],
    ["shared-dag", "shared-dag"],
    ["self-cycle", "self-cycle"],
    ["bigint", "bigint"],
    ["date", "date"],
    ["map", "map"],
    ["set", "set"],
    ["reference-document-input", "yaml-document-input"],
    ["reference-node-input", "yaml-node-input"],
  ] as const)
    rows.push({
      id: `stringify-${id}`,
      operation: "stringify",
      valueRecipe,
      options: { values: {} },
      source: "behavior-witness",
      categories: [
        "stringify",
        "special-value",
        ...(valueRecipe.startsWith("yaml-") ? ["ast-api"] : []),
      ],
    });
  for (const call of [
    "stringify-function-replacer",
    "stringify-array-replacer",
    "stringify-null-third",
    "stringify-shorthand-number",
    "stringify-shorthand-string",
  ] as const)
    rows.push({
      id: `overload-${call}`,
      operation: "stringify",
      graph: encodeGraph({ a: 1, drop: 2 }),
      call,
      options: { values: {} },
      source: "behavior-witness",
      categories: ["overload"],
    });
  rows.push({
    id: "parse-reviver-deletion",
    operation: "parse",
    text: '{"keep":1,"drop":2,"items":[1,2]}',
    call: "parse-reviver",
    options: { values: {} },
    source: "behavior-witness",
    categories: ["reviver"],
  });
  rows.push({
    id: "parse-reviver-root-array-hole",
    operation: "parse",
    text: "[1,2]",
    call: "parse-reviver-root",
    options: { values: {} },
    source: "behavior-witness",
    categories: ["reviver", "array-hole", "root"],
  });
  rows.push({
    id: "parse-options-reviver",
    operation: "parse",
    text: '{"a":1}',
    call: "parse-options-reviver",
    options: { values: {} },
    source: "behavior-witness",
    categories: ["reviver"],
  });
  rows.push({
    id: "parse-reviver-options-precedence",
    operation: "parse",
    text: '{"keep":1,"drop":2}',
    call: "parse-reviver",
    options: { values: {}, callback: "reviver-root" },
    source: "behavior-witness",
    categories: ["reviver", "overload-precedence"],
  });
  return rows;
}
export { inventories };
