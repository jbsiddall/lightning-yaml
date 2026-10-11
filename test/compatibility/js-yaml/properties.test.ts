import { test } from "@fast-check/vitest";
import fc from "fast-check";
import { describe, expect } from "vitest";
import type { CaseDescriptor, Operation } from "./types.js";
import { evaluate } from "./evaluate.js";
import { compareGraph, decodeGraph, encodeGraph } from "../shared/graph.js";
import { fullBooleanBasis, graphArb, textArb } from "./generators.js";

describe("differential property harness", () => {
  test.prop([
    textArb,
    fc.constantFrom<Operation>(
      "load",
      "loadAll-array",
      "loadAll-iterator-third",
    ),
  ])(
    "re-evaluation preserves value graphs, errors and callback effects",
    (text, operation) => {
      const descriptor: CaseDescriptor = {
        id: "property",
        operation,
        text,
        options: { values: {} },
        source: "property",
        categories: ["generated"],
      };
      const first = evaluate(descriptor),
        second = evaluate(descriptor);
      expect(first.differences).toEqual(second.differences);
      expect(first.reference.status).toBe(second.reference.status);
      expect(first.candidate.status).toBe(second.candidate.status);
      for (const side of ["reference", "candidate"] as const) {
        expect(compareGraph(first[side].value, second[side].value).equal).toBe(
          true,
        );
        expect(compareGraph(first[side].docs, second[side].docs).equal).toBe(
          true,
        );
        expect(first[side].text).toBe(second[side].text);
        expect(first[side].error).toEqual(second[side].error);
        expect(first[side].trace).toEqual(second[side].trace);
      }
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
  test("scalar style callbacks are replayable and expose the reference formatting effect", () => {
    const descriptor: CaseDescriptor = {
      id: "scalar-style-replay",
      operation: "dump",
      graph: encodeGraph({ value: "hello" }),
      options: { values: {}, scalarStyleRules: "double-quoted-values" },
      source: "sentinel",
      categories: ["sentinel"],
    };
    const replayed = JSON.parse(JSON.stringify(descriptor)) as CaseDescriptor;
    const row = evaluate(replayed);
    const again = evaluate(replayed);
    expect(row.reference.status).toBe("success");
    expect(row.reference.text).toBe('value: "hello"\n');
    expect(row.reference.trace).toEqual(again.reference.trace);
    expect(row.reference.trace).toContainEqual([
      "scalar-style-rule",
      0,
      false,
      "scalar",
      "hello",
      1,
    ]);
    expect(row.reference.trace).toContainEqual([
      "scalar-style-rule",
      1,
      false,
      "scalar",
      "hello",
      3,
    ]);
    expect(row.candidate.status).toBe("error");
    expect(row.differences.map((difference) => difference.category)).toContain(
      "acceptance",
    );
  });
  test("empty scalar style rules and explicit undefined remain distinct", () => {
    const base = {
      id: "scalar-style-distinction",
      operation: "dump" as const,
      graph: encodeGraph({ value: "hello" }),
      source: "sentinel",
      categories: ["sentinel"],
    };
    const empty = evaluate({ ...base, options: { values: {}, scalarStyleRules: "empty" } });
    const omitted = evaluate({ ...base, options: { values: {} } });
    const explicit = evaluate({ ...base, options: { values: {}, undefinedKeys: ["scalarStyleRules"] } });
    expect(empty.reference.status).toBe("success");
    expect(omitted.reference.text).toBe("value: hello\n");
    expect(explicit.reference.text).toBe(omitted.reference.text);
    expect(empty.reference.trace).toEqual([]);
    expect(explicit.reference.trace).toEqual(omitted.reference.trace);
  });
  test("mutated sharing topology is detected", () => {
    const shared = { v: 1 };
    expect(
      compareGraph({ a: shared, b: shared }, { a: { v: 1 }, b: { v: 1 } })
        .equal,
    ).toBe(false);
  });
});
