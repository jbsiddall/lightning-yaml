import { describe, expect, test } from "vitest";
import * as reference from "yaml";
import { encodeGraph } from "../shared/graph.js";
import {
  inventories,
  materializeOptions,
  optionKeys,
  runtimeInventory,
} from "./options.js";
import { optionWitnesses } from "./witnesses.js";

describe("yaml option inventory", () => {
  test("matches exact pinned declarations and separates shim allowlist from declared options", () => {
    const inventory = runtimeInventory();
    expect(inventory.declarationVerified).toBe(true);
    expect(inventory.runtimeVerified).toBe(true);
    expect(inventories.parse).toHaveLength(21);
    expect(inventories.stringify).toHaveLength(43);
    expect(inventories.shimRegistered.stringify).toHaveLength(18);
    expect(
      inventories.stringify.filter(
        (x) => !inventories.shimRegistered.stringify.includes(x),
      ),
    ).toHaveLength(25);
    expect(inventory.missingExports).toContain("Document");
  });
  test("option witness inventory schedules every declared key including unsupported fields", () => {
    const covered = new Set(
      optionWitnesses().flatMap((row) => optionKeys(row.options)),
    );
    for (const key of inventories.parse) expect(covered.has(key)).toBe(true);
    for (const key of inventories.stringify)
      expect(covered.has(key)).toBe(true);
  });
  test(
    "declarative onTagObj records metadata without changing the strict graph codec",
    () => {
    const trace: unknown[] = [];
    const options = materializeOptions(
      { values: {}, callback: "onTagObj-declarative-v1" },
      "reference",
      "stringify",
      trace,
    );
    expect(Object.keys(options)).toEqual(["onTagObj"]);
    expect(reference.stringify(null, options as never)).toBe("null\n");
    expect(trace).toEqual([
      ["onTagObj", { tag: "tag:yaml.org,2002:null", default: true }],
    ]);

    const noCallbackTrace: unknown[] = [];
    const withoutCallback = materializeOptions(
      { values: {}, callback: "onTagObj-declarative-v1" },
      "reference",
      "stringify",
      noCallbackTrace,
    );
    delete withoutCallback.onTagObj;
    expect(reference.stringify(null, withoutCallback as never)).toBe("null\n");
    expect(noCallbackTrace).toEqual([]);
      expect(() => encodeGraph({ fn() {} })).toThrow(
        "Cannot encode graph: function",
      );
    },
  );
  test("legacy onTagObj recipe retains its historical custom tag setup", () => {
    const options = materializeOptions(
      { values: {}, callback: "onTagObj" },
      "reference",
      "stringify",
      [],
    );
    expect(typeof options.onTagObj).toBe("function");
    expect(options.customTags).toHaveLength(1);
    expect(optionKeys({ values: {}, callback: "onTagObj" })).toEqual([
      "onTagObj",
    ]);
    expect(
      optionKeys({ values: {}, callback: "onTagObj-declarative-v1" }),
    ).toEqual(["onTagObj"]);
    expect(optionKeys({ values: {}, callback: "replacer-throw" })).toEqual([
      "replacer-throw",
    ]);
  });
});
