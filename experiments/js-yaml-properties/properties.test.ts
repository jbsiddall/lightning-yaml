import { test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { evaluate } from "./evaluate.js";
import { compareGraph, decodeGraph, encodeGraph } from "./graph.js";
import { fullBooleanBasis, graphArb, textArb } from "./generators.js";

describe("differential property harness", () => {
  test.prop([textArb])(
    "one descriptor yields the same case identity when replayed",
    (text) => {
      const d = {
        id: "property",
        operation: "load" as const,
        text,
        options: { values: {} },
        source: "property",
        categories: ["generated"],
      };
      const first = evaluate(d),
        second = evaluate(d);
      expect(first.differences).toEqual(second.differences);
      expect(first.reference.status).toBe(second.reference.status);
      expect(first.candidate.status).toBe(second.candidate.status);
    },
  );
  test.prop([graphArb])(
    "generated values survive graph recipe round trips",
    (value) => {
      expect(compareGraph(value, decodeGraph(encodeGraph(value))).equal).toBe(
        true,
      );
    },
  );
  test("complete finite dump boolean basis has 4096 distinct assignments", () => {
    const basis = fullBooleanBasis();
    expect(basis).toHaveLength(4096);
    expect(new Set(basis.map((x) => JSON.stringify(x.values))).size).toBe(4096);
  });
  test("unsupported candidate load option remains an acceptance discrepancy", () => {
    const row = evaluate({
      id: "unsupported",
      operation: "load",
      text: "a: 1\n",
      options: { values: { maxDepth: 3 } },
      source: "sentinel",
      categories: ["sentinel"],
    });
    expect(row.reference.status).toBe("success");
    expect(row.candidate.status).toBe("error");
    expect(row.differences.map((x) => x.category)).toContain("acceptance");
  });
  test("mutated sharing topology is detected", () => {
    const shared = { v: 1 };
    expect(
      compareGraph({ a: shared, b: shared }, { a: { v: 1 }, b: { v: 1 } })
        .equal,
    ).toBe(false);
  });
});
