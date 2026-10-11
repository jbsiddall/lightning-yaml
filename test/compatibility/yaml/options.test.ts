import { describe, expect, test } from "vitest";
import { inventories, optionKeys, runtimeInventory } from "./options.js";
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
});
