import fc from "fast-check";
import { expect, test } from "vitest";
import {
  generatedDumps,
  generatedLoad,
  scalarArb,
  scalarSchema,
} from "./generators.js";

test("scalar arbitrary preserves the bounded legacy domain", () => {
  const values = fc.sample(scalarArb, { seed: 20261011, numRuns: 20_000 });

  expect(values.every((value) => scalarSchema.safeParse(value).success)).toBe(true);
  expect(
    values.every((value) => typeof value !== "string" || value.length <= 10),
  ).toBe(true);
  expect(
    values.every(
      (value) =>
        typeof value !== "number" ||
        value === Infinity ||
        (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER),
    ),
  ).toBe(true);
  expect(values.some((value) => value === null)).toBe(true);
  expect(values.some((value) => typeof value === "boolean")).toBe(true);
  expect(values.some((value) => typeof value === "string")).toBe(true);
  expect(
    values.some(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        !Number.isInteger(value),
    ),
  ).toBe(true);
  expect(values.some((value) => Object.is(value, -0))).toBe(true);
  expect(values.some((value) => value === Infinity)).toBe(true);
  expect(
    values.some(
      (value) =>
        typeof value === "number" &&
        (Number.isNaN(value) || value === -Infinity),
    ),
  ).toBe(false);
});

test("scalar failure shrinking replays at the returned fast-check path", () => {
  const property = fc.property(
    scalarArb,
    (value) => typeof value !== "string" || value.length === 0,
  );
  const failure = fc.check(property, { seed: 20261011, numRuns: 1000 });

  if (!failure.failed || failure.counterexamplePath === null)
    throw new Error("expected a replayable shrinking failure");
  expect(failure.numShrinks).toBeGreaterThan(0);
  const replay = fc.check(property, {
    seed: failure.seed,
    path: failure.counterexamplePath,
    numRuns: 1000,
  });
  expect(replay.failed).toBe(true);
  expect(replay.counterexample).toEqual(failure.counterexample);
});

test("generated descriptors are deterministic and keep descriptor replay inputs", () => {
  const loads = generatedLoad(123, 5);
  const dumps = generatedDumps(123, 5);

  expect(generatedLoad(123, 5)).toEqual(loads);
  expect(generatedDumps(123, 5)).toEqual(dumps);
  expect(generatedLoad(124, 5)).not.toEqual(loads);
  expect(generatedDumps(124, 5)).not.toEqual(dumps);
  expect(loads.map(({ id, seed, source }) => ({ id, seed, source }))).toEqual(
    loads.map((_, index) => ({ id: `gen-load-${index}`, seed: 123, source: "generated-grammar" })),
  );
  expect(dumps.map(({ id, seed, source }) => ({ id, seed, source }))).toEqual(
    dumps.map((_, index) => ({
      id: `gen-dump-${index}`,
      seed: 123,
      source: "generated-graph",
    })),
  );
});
