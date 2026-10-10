import * as real from "js-yaml";
import * as candidate from "../../src/js-yaml-compat.ts";
import type { DumpOptions, LoadOptions } from "js-yaml";
import type { OptionRecipe, SchemaRecipe } from "./types.js";

export const loadKeys = [
  "filename",
  "schema",
  "json",
  "maxDepth",
  "maxAliases",
  "maxTotalMergeKeys",
] as const;
export const dumpKeys = [
  "schema",
  "indent",
  "seqNoIndent",
  "seqInlineFirst",
  "sortKeys",
  "lineWidth",
  "flowBracketPadding",
  "flowSkipCommaSpace",
  "flowSkipColonSpace",
  "quoteFlowKeys",
  "quoteStyle",
  "forceQuotes",
  "tagBeforeAnchor",
  "skipInvalid",
  "noRefs",
  "flowLevel",
  "transform",
] as const;
export const legacyKeys = [
  "listener",
  "onWarning",
  "styles",
  "replacer",
] as const;
type Same<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
const loadDeclarationExact: Same<keyof LoadOptions, (typeof loadKeys)[number]> =
  true;
const dumpDeclarationExact: Same<keyof DumpOptions, (typeof dumpKeys)[number]> =
  true;
void loadDeclarationExact;
void dumpDeclarationExact;
export const schemaIds: SchemaRecipe[] = [
  "default",
  "failsafe",
  "json",
  "core",
  "yaml11",
  "custom-scalar",
];
function customScalarSchema(side: "reference" | "candidate"): unknown {
  if (side === "reference") {
    const tag = real.defineScalarTag("!audit-upper", {
      resolve: (source: string) => `AUDIT:${source.toUpperCase()}`,
      identify: (value: unknown) =>
        typeof value === "string" && value.startsWith("AUDIT:"),
      represent: (value: unknown) => String(value).slice(6),
    });
    return real.CORE_SCHEMA.withTags(tag);
  }
  const tag = candidate.defineScalarTag("!audit-upper", {
    resolve: (source: string) => `AUDIT:${source.toUpperCase()}`,
    identify: (value: unknown) =>
      typeof value === "string" && value.startsWith("AUDIT:"),
    represent: (value: unknown) => String(value).slice(6),
  });
  return candidate.CORE_SCHEMA.withTags(tag);
}
export function schemaFor(
  side: "reference" | "candidate",
  id?: SchemaRecipe,
): unknown {
  if (!id || id === "default") return undefined;
  if (id === "custom-scalar") return customScalarSchema(side);
  const realSchemas = {
    failsafe: real.FAILSAFE_SCHEMA,
    json: real.JSON_SCHEMA,
    core: real.CORE_SCHEMA,
    yaml11: real.YAML11_SCHEMA,
  };
  const candidateSchemas = {
    failsafe: candidate.FAILSAFE_SCHEMA,
    json: candidate.JSON_SCHEMA,
    core: candidate.CORE_SCHEMA,
    yaml11: candidate.YAML11_SCHEMA,
  };
  return side === "reference" ? realSchemas[id] : candidateSchemas[id];
}
export function materializeOptions(
  recipe: OptionRecipe,
  side: "reference" | "candidate",
  _operation: string,
  trace: unknown[],
): Record<string, unknown> {
  const out = { ...recipe.values };
  for (const key of recipe.undefinedKeys ?? []) out[key] = undefined;
  if (recipe.schema) out.schema = schemaFor(side, recipe.schema);
  if (recipe.callback) {
    if (recipe.callback.startsWith("sort-"))
      out.sortKeys = (a: unknown, b: unknown) => {
        trace.push(["sort", a, b]);
        return recipe.callback === "sort-desc"
          ? String(b).localeCompare(String(a))
          : String(a).localeCompare(String(b));
      };
    if (
      recipe.callback === "identity" ||
      recipe.callback === "mutate" ||
      recipe.callback === "throw"
    )
      out.transform = (docs: { contents?: unknown }[]) => {
        trace.push(["transform", docs.length]);
        if (recipe.callback === "throw")
          throw new Error("transform callback sentinel");
        if (recipe.callback === "mutate" && docs[0]) docs[0].contents = null;
      };
  }
  if (recipe.legacy) {
    out.listener = () => trace.push(["listener"]);
    out.onWarning = () => trace.push(["onWarning"]);
    out.replacer = (_key: string, value: unknown) => {
      trace.push(["replacer", _key]);
      return value;
    };
    out.styles = { "!!str": "double" };
  }
  return out;
}
export function inventory() {
  const runtimeVerified =
    typeof real.load === "function" &&
    typeof real.loadAll === "function" &&
    typeof real.dump === "function";
  const parsed = real.load("a: 1\n") as Record<string, unknown>,
    emitted = real.dump({ a: 1 });
  const probePassed =
    runtimeVerified &&
    parsed.a === 1 &&
    typeof emitted === "string" &&
    emitted.length > 0;
  if (!probePassed)
    throw new Error("js-yaml runtime default-option probe failed");
  return {
    load: [...loadKeys],
    dump: [...dumpKeys],
    legacy: [...legacyKeys],
    declarationVerified: true,
    runtimeVerified: probePassed,
    runtimeDefaultOptionObjects:
      "js-yaml v5 exposes no DEFAULT_OPTIONS object; the runtime default load/dump behavior is probed",
  };
}

export function optionKeys(recipe: OptionRecipe): string[] {
  return [
    ...new Set([
      ...Object.keys(recipe.values),
      ...(recipe.undefinedKeys ?? []),
      ...(recipe.schema ? ["schema"] : []),
      ...(recipe.callback
        ? [recipe.callback.startsWith("sort-") ? "sortKeys" : "transform"]
        : []),
      ...(recipe.legacy ? [...legacyKeys] : []),
    ]),
  ].sort();
}
