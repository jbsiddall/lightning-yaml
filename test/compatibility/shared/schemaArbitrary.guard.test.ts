import { beforeEach, expect, test, vi } from "vitest";
import fc from "fast-check";

const generated = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("@traversable/zod-test/fuzz", async () => {
  const fc = await import("fast-check");
  return { fuzz: () => fc.constant(generated.value) };
});

import { schemaArbitrary } from "./schemaArbitrary.js";
import { z } from "zod";

beforeEach(() => {
  generated.value = undefined;
});

test("schema arbitrary rejects an invalid adapter value and preserves valid input identity", () => {
  const constrained = z.number().min(5).max(5);
  generated.value = 4;
  expect(() => fc.sample(schemaArbitrary(constrained), { numRuns: 1 })).toThrow(
    "Schema generator produced invalid input",
  );

  const input = { tag: "row" };
  generated.value = input;
  expect(
    fc.sample(schemaArbitrary(z.object({ tag: z.literal("row") })), {
      numRuns: 1,
    })[0],
  ).toBe(input);
});
