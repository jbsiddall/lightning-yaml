import { expect, test } from "vitest";
import { encodeGraph } from "../shared/graph.js";
import { evaluate } from "./evaluate.js";
import { summarize } from "./campaign.js";

test("scalar style replay callback metric uses only active callback rows", () => {
  const base = {
    operation: "dump" as const,
    graph: encodeGraph({ value: "hello" }),
    source: "sentinel",
    categories: ["sentinel"],
  };
  const rows = [
    evaluate({
      ...base,
      id: "active-scalar-style",
      options: { values: {}, scalarStyleRules: "double-quoted-values" },
    }),
    evaluate({
      ...base,
      id: "empty-scalar-style",
      options: { values: {}, scalarStyleRules: "empty" },
    }),
  ];
  const metric = summarize(rows).callbackDifferences;
  expect(metric).toEqual({ numerator: 1, denominator: 1, percent: 100 });
  expect(metric.numerator).toBeLessThanOrEqual(metric.denominator);
});
