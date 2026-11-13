import fc from "fast-check";
import { expect, test } from "vitest";
import { z } from "zod";
import { schemaArbitrary } from "./schemaArbitrary.js";

test("schema arbitrary derives nested values from its input schema", () => {
  const schema = z.object({
    tag: z.literal("row"),
    values: z.array(z.string()),
  });
  const arbitrary = schemaArbitrary(schema, { array: { maxLength: 6 } });
  const samples = fc.sample(arbitrary, { seed: 42, numRuns: 200 });

  expect(samples.every((value) => schema.safeParse(value).success)).toBe(true);
  expect(samples.every((value) => value.tag === "row")).toBe(true);
  expect(
    new Set(samples.map((value) => value.values.join("\u0000"))).size,
  ).toBeGreaterThan(1);
  expect(
    Math.max(...samples.map((value) => value.values.length)),
  ).toBeLessThanOrEqual(6);
});

