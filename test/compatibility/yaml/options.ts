import * as reference from "yaml";
import * as candidate from "../../../src/yaml-compat.ts";
import type {
  ParseOptions,
  DocumentOptions,
  SchemaOptions,
  ToJSOptions,
  CreateNodeOptions,
  ToStringOptions,
} from "yaml";
import type { CallbackRecipe, OptionRecipe } from "./types.js";
import { encodeGraph } from "../shared/graph.js";
import { LineCounter } from "yaml";

export const callbackRecipeOptionKeys: Record<CallbackRecipe, string> = {
  directives: "_directives",
  "reviver-delete": "reviver",
  "reviver-root": "reviver",
  onAnchor: "onAnchor",
  uniqueKeys: "uniqueKeys",
  sortMapEntries: "sortMapEntries",
  commentString: "commentString",
  onTagObj: "onTagObj",
  "onTagObj-declarative-v1": "onTagObj",
  customTags: "customTags",
  "customTags-array": "customTags",
  replacer: "replacer",
  "replacer-throw": "replacer-throw",
};
export function isCallbackRecipe(value: unknown): value is CallbackRecipe {
  return (
    typeof value === "string" &&
    Object.hasOwn(callbackRecipeOptionKeys, value)
  );
}

type Same<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
const parseKeys = [
  "intAsBigInt",
  "keepSourceTokens",
  "lineCounter",
  "prettyErrors",
  "strict",
  "stringKeys",
  "uniqueKeys",
] as const satisfies readonly (keyof ParseOptions)[];
const documentKeys = [
  "_directives",
  "logLevel",
  "version",
] as const satisfies readonly (keyof DocumentOptions)[];
const schemaKeys = [
  "compat",
  "customTags",
  "merge",
  "resolveKnownTags",
  "schema",
  "sortMapEntries",
  "toStringDefaults",
] as const satisfies readonly (keyof SchemaOptions)[];
const toJSKeys = [
  "mapAsMap",
  "maxAliasCount",
  "onAnchor",
  "reviver",
] as const satisfies readonly (keyof ToJSOptions)[];
const createNodeKeys = [
  "aliasDuplicateObjects",
  "anchorPrefix",
  "flow",
  "keepUndefined",
  "onTagObj",
  "tag",
] as const satisfies readonly (keyof CreateNodeOptions)[];
const toStringKeys = [
  "blockQuote",
  "collectionStyle",
  "commentString",
  "defaultKeyType",
  "defaultStringType",
  "directives",
  "doubleQuotedAsJSON",
  "doubleQuotedMinMultiLineLength",
  "falseStr",
  "flowCollectionPadding",
  "indent",
  "indentSeq",
  "lineWidth",
  "minContentWidth",
  "nullStr",
  "simpleKeys",
  "singleQuote",
  "trailingComma",
  "trueStr",
  "verifyAliasOrder",
] as const satisfies readonly (keyof ToStringOptions)[];
const _parseExact: Same<keyof ParseOptions, (typeof parseKeys)[number]> = true;
const _docExact: Same<keyof DocumentOptions, (typeof documentKeys)[number]> =
  true;
const _schemaExact: Same<keyof SchemaOptions, (typeof schemaKeys)[number]> =
  true;
const _toJSExact: Same<keyof ToJSOptions, (typeof toJSKeys)[number]> = true;
const _createExact: Same<
  keyof CreateNodeOptions,
  (typeof createNodeKeys)[number]
> = true;
const _stringExact: Same<keyof ToStringOptions, (typeof toStringKeys)[number]> =
  true;
void [
  _parseExact,
  _docExact,
  _schemaExact,
  _toJSExact,
  _createExact,
  _stringExact,
];
type StringifyKeys =
  | keyof ParseOptions
  | keyof DocumentOptions
  | keyof SchemaOptions
  | keyof CreateNodeOptions
  | keyof ToStringOptions;
const stringifyKeys = [
  ...parseKeys,
  ...documentKeys,
  ...schemaKeys,
  ...createNodeKeys,
  ...toStringKeys,
] as const satisfies readonly StringifyKeys[];
const _stringifyExact: Same<StringifyKeys, (typeof stringifyKeys)[number]> =
  true;
void _stringifyExact;
export const inventories = {
  parse: [...parseKeys, ...documentKeys, ...schemaKeys, ...toJSKeys],
  document: [...parseKeys, ...documentKeys, ...schemaKeys],
  stringify: [...stringifyKeys],
  declarations: {
    ParseOptions: [...parseKeys],
    DocumentOptions: [...documentKeys],
    SchemaOptions: [...schemaKeys],
    ToJSOptions: [...toJSKeys],
    CreateNodeOptions: [...createNodeKeys],
    ToStringOptions: [...toStringKeys],
  },
  shimRegistered: {
    parse: [
      "schema",
      "version",
      "prettyErrors",
      "mapAsMap",
      "intAsBigInt",
      "uniqueKeys",
      "stringKeys",
      "merge",
      "maxAliasCount",
      "customTags",
      "resolveKnownTags",
      "keepSourceTokens",
      "lineCounter",
      "onAnchor",
    ],
    stringify: [
      "schema",
      "version",
      "singleQuote",
      "sortMapEntries",
      "indent",
      "nullStr",
      "trueStr",
      "falseStr",
      "indentSeq",
      "directives",
      "lineWidth",
      "minContentWidth",
      "blockQuote",
      "collectionStyle",
      "flowCollectionPadding",
      "aliasDuplicateObjects",
      "anchorPrefix",
      "customTags",
    ],
  },
  exports: Object.keys(reference)
    .filter((k) => k !== "default")
    .sort(),
  candidateExports: Object.keys(candidate)
    .filter((k) => k !== "default")
    .sort(),
  missingExports: Object.keys(reference)
    .filter((k) => k !== "default" && !(k in candidate))
    .sort(),
  documentMethods: methodNames(reference.parseDocument("")),
  candidateDocumentMethods: methodNames(candidate.parseDocument("")),
};
function methodNames(instance: object): string[] {
  const names = new Set<string>();
  let current: object | null = instance;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (
        typeof key === "string" &&
        typeof (current as Record<string, unknown>)[key] === "function"
      )
        names.add(key);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names].sort();
}
export function materializeOptions(
  recipe: OptionRecipe,
  side: "reference" | "candidate",
  _operation: string,
  trace: unknown[],
): Record<string, unknown> {
  const directivesOfSide = () =>
    side === "reference"
      ? (reference.parseDocument("") as unknown as { directives: unknown })
          .directives
      : (candidate.parseDocument("") as unknown as { directives: unknown })
          .directives;
  const out: Record<string, unknown> = { ...recipe.values };
  for (const key of recipe.undefinedKeys ?? []) out[key] = undefined;
  if (out.lineCounter === "lineCounter") {
    out.lineCounter = new LineCounter();
    trace.push(["lineCounter", out.lineCounter]);
  }
  if (out._directives === "directives") out._directives = directivesOfSide();
  if (recipe.callback) {
    const record = (...args: unknown[]) => {
      trace.push([recipe.callback, ...args.map(summarizeCallbackValue)]);
    };
    switch (recipe.callback) {
      case "directives":
        out._directives = directivesOfSide();
        break;
      case "reviver-delete":
        out.reviver = function (this: unknown, key: string, value: unknown) {
          record(key, this, value);
          return key === "drop" ? undefined : value;
        };
        break;
      case "reviver-root":
        out.reviver = function (this: unknown, key: string, value: unknown) {
          record(key, this, value);
          return key === "" ? { wrapped: value } : value;
        };
        break;
      case "onAnchor":
        out.onAnchor = (value: unknown, count: number) => record(value, count);
        break;
      case "uniqueKeys":
        out.uniqueKeys = (a: unknown, b: unknown) => {
          record(a, b);
          return true;
        };
        break;
      case "sortMapEntries":
        out.sortMapEntries = (
          a: { key?: { value?: unknown } },
          b: { key?: { value?: unknown } },
        ) => {
          record(a?.key?.value, b?.key?.value);
          return String(a?.key?.value).localeCompare(String(b?.key?.value));
        };
        break;
      case "commentString":
        out.commentString = (comment: string) => {
          record(comment);
          return `CUSTOM ${comment}`;
        };
        break;
      case "onTagObj":
        // Saved descriptors depend on this custom-tag setup and full-object trace.
        out.onTagObj = (tag: unknown) => record(tag);
        out.customTags = [
          {
            tag: "tag:example.com,2026:word",
            identify: (value: unknown) =>
              Boolean(value && typeof value === "object" && "_custom" in value),
            resolve: () => "custom",
            stringify: (value: { _custom: unknown }) => String(value._custom),
          },
        ];
        break;
      case "onTagObj-declarative-v1":
        out.onTagObj = (tag: unknown) => {
          const metadata = tag as { tag?: unknown; default?: unknown };
          trace.push([
            "onTagObj",
            { tag: metadata.tag, default: metadata.default },
          ]);
        };
        break;
      case "customTags":
        out.customTags = (tags: unknown[]) => {
          record(tags);
          return tags;
        };
        break;
      case "customTags-array":
        out.customTags = [
          {
            tag: "tag:example.com,2026:word",
            resolve: (s: string) => s.toUpperCase(),
          },
        ];
        break;
      case "replacer":
        out.replacer = function (this: unknown, key: string, value: unknown) {
          record(key, this, value);
          return key === "drop" ? undefined : value;
        };
        break;
      case "replacer-throw":
        out.replacer = () => {
          throw new Error("replacer sentinel");
        };
        break;
      default:
        throw new TypeError(`Unknown YAML callback recipe ${recipe.callback}`);
    }
  }
  if (recipe.schema) out.schema = recipe.schema;
  return out;
}
export function summarizeCallbackValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  const kind = v.constructor?.name;
  if (["Scalar", "Alias", "Pair", "YAMLMap", "YAMLSeq"].includes(kind)) {
    const n = v as {
      value?: unknown;
      key?: unknown;
      tag?: unknown;
      anchor?: unknown;
      source?: unknown;
    };
    return {
      kind,
      value: n.value,
      key: n.key && (n.key as { value?: unknown }).value,
      tag: n.tag,
      anchor: n.anchor,
      source: n.source,
    };
  }
  return { graph: encodeGraph(v) };
}
export function optionKeys(recipe: OptionRecipe): string[] {
  return [
    ...new Set([
      ...Object.keys(recipe.values),
      ...(recipe.undefinedKeys ?? []),
      ...(recipe.callback
        ? [callbackRecipeOptionKeys[recipe.callback]]
        : []),
      ...(recipe.schema ? ["schema"] : []),
    ]),
  ].sort();
}
export function registeredStatus(
  operation: string,
  key: string,
): "registered" | "unknown" {
  return (
    (operation === "stringify"
      ? inventories.shimRegistered.stringify
      : inventories.shimRegistered.parse) as string[]
  ).includes(key)
    ? "registered"
    : "unknown";
}
export function runtimeInventory() {
  const probe = reference.parse("a: 1\n") as Record<string, unknown>;
  if (probe.a !== 1 || typeof reference.stringify({ a: 1 }) !== "string")
    throw new Error("yaml runtime probe failed");
  return { ...inventories, runtimeVerified: true, declarationVerified: true };
}
