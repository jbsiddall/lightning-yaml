import { expect, test } from "vitest";
import { singleOptionWitnesses } from "./generators.js";
import {
  dumpKeys,
  loadKeys,
  materializeOptions,
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
