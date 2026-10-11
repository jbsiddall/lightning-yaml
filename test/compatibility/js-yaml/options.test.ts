import { expect, test } from "vitest";
import { singleOptionWitnesses } from "./generators.js";
import {
  dumpKeys,
  loadKeys,
  materializeOptions,
  inventory,
  optionKeys,
} from "./options.js";

test.each([
  ["load", loadKeys],
  ["dump", dumpKeys],
] as const)(
  "every declared %s option has a scheduled witness",
  (operation, expected) => {
    const tested = new Set(
      singleOptionWitnesses()
        .filter((witness) => witness.operation === operation)
        .flatMap((witness) => optionKeys(witness.options)),
    );
    expect([...tested].sort()).toEqual([...expected].sort());
  },
);

test("explicit undefined survives JSON replay and remains distinct from an omitted option", () => {
  const recipe = JSON.parse(
    JSON.stringify({ values: {}, undefinedKeys: ["indent"] }),
  );
  const explicit = materializeOptions(recipe, "reference", "dump", []);
  const omitted = materializeOptions({ values: {} }, "reference", "dump", []);
  expect(Object.hasOwn(explicit, "indent")).toBe(true);
  expect(Object.hasOwn(omitted, "indent")).toBe(false);
  expect(optionKeys(recipe)).toEqual(["indent"]);
});

test("runtime export inventory reports candidate API gaps separately", () => {
  const { runtimeExports } = inventory();
  expect(runtimeExports.reference).toContain("DEFAULT_SCALAR_STYLE_RULES");
  expect(runtimeExports.reference).toContain("DUMP_SCHEMA");
  expect(runtimeExports.candidateMissing).toContain("DEFAULT_SCALAR_STYLE_RULES");
  expect(runtimeExports.candidateMissing).toContain("DUMP_SCHEMA");
  expect(runtimeExports.candidateExtra).toContain("default");
});

test("scalar style recipes survive JSON replay and materialize distinct rule arrays", () => {
  const recipe = JSON.parse(
    JSON.stringify({ values: {}, scalarStyleRules: "double-quoted-values" }),
  );
  const trace: unknown[] = [];
  const options = materializeOptions(recipe, "reference", "dump", trace);
  expect(optionKeys(recipe)).toEqual(["scalarStyleRules"]);
  expect(options.scalarStyleRules).toHaveLength(2);
  expect(materializeOptions({ values: {}, scalarStyleRules: "empty" }, "reference", "dump", [])
    .scalarStyleRules).toEqual([]);
  expect(materializeOptions({ values: {}, undefinedKeys: ["scalarStyleRules"] }, "reference", "dump", []))
    .toHaveProperty("scalarStyleRules", undefined);
});

test("unknown scalar style recipes fail instead of dropping the option", () => {
  const recipe = JSON.parse(
    JSON.stringify({ values: {}, scalarStyleRules: "future-recipe" }),
  );
  expect(() => materializeOptions(recipe, "reference", "dump", [])).toThrow(
    "Unknown scalarStyleRules recipe: future-recipe",
  );
});
