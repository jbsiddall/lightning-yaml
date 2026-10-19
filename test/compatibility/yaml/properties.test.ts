import { describe, expect, test, vi } from "vitest";
import fc from "fast-check";
import * as yamlReference from "yaml";
import { parse, parseAllDocuments, parseDocument } from "../../../src/yaml-compat.ts";
import { parseAll as coreParseAll } from "../../../src/core.ts";
import { load as jsYamlLoad } from "../../../src/js-yaml-compat.ts";
import { evaluate } from "./evaluate.js";
import {
  finiteBases,
  behaviorWitnesses,
  optionWitnesses,
} from "./witnesses.js";
import { compareGraph, decodeGraph, encodeGraph } from "../shared/graph.js";

describe("yaml compatibility differential properties", () => {
  test("generated suffix streams preserve yaml document counts across entrypoints", () => {
    const eolArb = fc.constantFrom("\n", "\r\n");
    const streamArb = fc.record({
      eol: eolArb,
      bom: fc.boolean(),
      trivia: fc.array(fc.constantFrom("", "# leading", "  # leading"), { maxLength: 3 }),
      suffixes: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
      value: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
    }).map(({ eol, bom, trivia, suffixes, value }) => {
      const lines = [
        ...trivia,
        ...suffixes.map((comment) => comment ? "... # suffix" : "..."),
        ...(value === undefined ? [] : [`value: ${value}`]),
      ];
      return {
        text: (bom ? "\ufeff" : "") + lines.join(eol) + eol,
        expected: [...suffixes.map(() => null), ...(value === undefined ? [] : [{ value }])],
        value,
      };
    });

    fc.assert(fc.property(streamArb, ({ text, expected, value }) => {
      const referenceDocs = yamlReference.parseAllDocuments(text);
      const candidateDocs = parseAllDocuments(text);
      expect(referenceDocs.map((doc) => doc.toJS())).toEqual(expected);
      expect(candidateDocs.map((doc) => doc.toJS())).toEqual(expected);
      expect(candidateDocs.map((doc) => doc.errors.length)).toEqual(
        referenceDocs.map((doc) => doc.errors.length),
      );

      const referenceDocument = yamlReference.parseDocument(text);
      const candidateDocument = parseDocument(text);
      expect(candidateDocument.toJS()).toEqual(referenceDocument.toJS());
      expect(candidateDocument.errors.length > 0).toBe(referenceDocument.errors.length > 0);

      const capture = (fn: () => unknown) => {
        try { return { ok: true as const, value: fn() }; }
        catch { return { ok: false as const }; }
      };
      const referenceParse = capture(() => yamlReference.parse(text));
      const candidateParse = capture(() => parse(text));
      expect(candidateParse.ok).toBe(referenceParse.ok);
      if (referenceParse.ok && candidateParse.ok) expect(candidateParse.value).toEqual(referenceParse.value);

      const nativeExpected = expected.filter((value) => value !== null);
      expect(coreParseAll(text)).toEqual(nativeExpected);
      expect(coreParseAll(text, {})).toEqual(nativeExpected);
      if (value === undefined) {
        expect(() => jsYamlLoad(text)).toThrow();
      } else {
        expect(jsYamlLoad(text)).toEqual({ value });
      }
    }), { numRuns: 100, seed: 13290 });
  });

  test("simple generated JSON-compatible graphs stringify and parse equally when the oracle accepts them", () => {
    const values = [
      null,
      true,
      2,
      "text",
      [1, "x", false],
      { a: 1, nested: { b: "v" } },
    ];
    for (const [i, value] of values.entries()) {
      const result = evaluate({
        id: `pass-${i}`,
        operation: "stringify",
        graph: encodeGraph(value),
        options: { values: {} },
        source: "property",
        categories: ["passing-subset"],
      });
      expect(result.reference.status).toBe("success");
      expect(result.candidate.status).toBe("success");
      expect(result.semantic?.equal).toBe(true);
    }
  });
  test("records a known unsupported option gap", () => {
    const row = evaluate({
      id: "known-gap",
      operation: "parse",
      text: "a: 1\n",
      options: { values: { strict: true } },
      source: "sentinel",
      categories: ["gap"],
    });
    expect(row.reference.status).toBe("success");
    expect(row.candidate.status).toBe("error");
    expect(row.differences.map((d) => d.category)).toContain("acceptance");
  });
  test("keeps document AST mismatch separate from converted-value agreement", () => {
    const row = evaluate({
      id: "ast-gap",
      operation: "parseDocument",
      text: "a: 1\n",
      options: { values: {} },
      source: "sentinel",
      categories: ["document"],
    });
    expect(row.differences.map((d) => d.category)).toContain("document-ast");
    expect(row.differences.map((d) => d.category)).toContain(
      "document-semantic",
    );
    expect((row.reference.docs?.[0] as { toJS: unknown }).toJS).toEqual(
      (row.candidate.docs?.[0] as { toJS: unknown }).toJS,
    );
  });
  test("retains partial stream recovery and diagnostics as observable differences", () => {
    const row = evaluate(
      behaviorWitnesses().find(
        (x) => x.id === "partial-stream-parseAllDocuments",
      )!,
    );
    expect(row.reference.status).toBe("success");
    expect(row.candidate.status).toBe("success");
    expect(
      row.differences.some((d) =>
        ["diagnostic", "document-semantic"].includes(d.category),
      ),
    ).toBe(true);
  });
  test("preserves undefined stringify return as a successful call result", () => {
    const row = evaluate({
      id: "undefined",
      operation: "stringify",
      valueRecipe: "undefined",
      options: { values: {} },
      source: "sentinel",
      categories: ["contract"],
    });
    expect(row.reference.status).toBe("success");
    expect(row.reference.text).toBeUndefined();
    expect(
      row.differences.map((difference) => difference.category),
    ).not.toContain("stringify-bytes");
  });
  test("stream metadata and callback witnesses are observed on the oracle", () => {
    const emptyStream = evaluate({
      id: "empty-stream",
      operation: "parseAllDocuments",
      text: "# only a comment\n",
      options: { values: {} },
      source: "sentinel",
      categories: ["stream"],
    });
    expect(emptyStream.reference.stream).toBeDefined();
    for (const id of [
      "callback-parse-onAnchor-onAnchor",
      "callback-parse-uniqueKeys-uniqueKeys",
      "callback-parse-reviver-reviver-delete",
      "callback-stringify-commentString-commentString",
    ]) {
      const row = evaluate(optionWitnesses().find((x) => x.id === id)!);
      expect(row.reference.trace.length, id).toBeGreaterThan(0);
    }
  });
  test("reviver deletion is captured as a successful parse plus callback trace", () => {
    const row = evaluate(
      behaviorWitnesses().find((x) => x.id === "parse-reviver-deletion")!,
    );
    expect(row.reference.status).toBe("success");
    expect(row.reference.trace.length).toBeGreaterThan(0);
    expect(row.reference.value).toEqual({ keep: 1, items: [1, undefined] });
  });
  test("reviver observes the synthetic root and preserves array deletion as a hole", () => {
    const row = evaluate(
      behaviorWitnesses().find(
        (descriptor) => descriptor.id === "parse-reviver-root-array-hole",
      )!,
    );
    expect(row.reference.value).toEqual({ wrapped: [1, undefined] });
    const wrappedArray = (row.reference.value as { wrapped: unknown[] })
      .wrapped;
    expect(1 in wrappedArray).toBe(false);
    expect(
      row.reference.trace.some(
        (entry) => Array.isArray(entry) && entry[1] === "",
      ),
    ).toBe(true);
    expect(row.differences).toEqual([]);
  });
  test("scheduled onTagObj callback witness records the reference event", () => {
    const descriptor = optionWitnesses().find(
      (row) => row.options.callback === "onTagObj-declarative-v1" && row.id.startsWith("callback-stringify-onTagObj"),
    )!;
    const row = evaluate(descriptor);

    expect(row.reference.status).toBe("success");
    expect(row.reference.text).toBe("null\n");
    expect(row.reference.trace).toEqual([
      ["onTagObj", { tag: "tag:yaml.org,2002:null", default: true }],
    ]);
    expect(row.candidate.status).toBe("error");
    expect(row.candidate.trace).toEqual([]);
    expect(row.differences.map(({ category }) => category).sort()).toEqual([
      "acceptance",
      "callback",
      "stringify-semantic",
    ]);
    const encodedTrace = encodeGraph(row.reference.trace);
    expect(compareGraph(row.reference.trace, decodeGraph(encodedTrace)).equal).toBe(true);
  });
  test("versioned Document.toJSON anchor call retains callback identities", () => {
    const descriptor = optionWitnesses().find(
      (row) => row.id === "document-toJSON-onAnchor-v1",
    )!;
    const toJSON = vi.spyOn(yamlReference.Document.prototype, "toJSON");
    let row: ReturnType<typeof evaluate>;
    try {
      row = evaluate(JSON.parse(JSON.stringify(descriptor)));
      expect(toJSON).toHaveBeenCalledTimes(1);
      expect(toJSON.mock.calls[0]?.[0]).toBe("anchor-probe-v1");
      expect(typeof toJSON.mock.calls[0]?.[1]).toBe("function");
    } finally {
      toJSON.mockRestore();
    }
    type ObservedMap = { left: unknown; right: unknown };
    type Observation = {
      result: { first: ObservedMap; second: unknown };
      calls: unknown[][];
    };
    const observation = (row.reference.docs?.[0] as Record<string, unknown>)
      .toJSONAnchorObservation as Observation;
    const result = observation.result;
    const calls = observation.calls;

    expect(row.reference.status).toBe("success");
    expect(row.reference.docs?.[0]).toMatchObject({ errors: [], warnings: [] });
    expect(Object.getPrototypeOf(result.first)).toBe(Object.prototype);
    expect(result.first).toBe(result.second);
    expect(result.first.left).toBe(result.first.right);
    expect(calls).toHaveLength(2);
    expect(calls.map((args) => args.length)).toEqual([2, 2]);
    expect(calls.map((args) => args[1])).toEqual([2, 2]);
    expect(calls[0][0]).toBe(result.first);
    expect(calls[1][0]).toBe(result.first.left);
    expect((calls[0]?.[0] as ObservedMap).left).toBe(calls[1]?.[0]);
    expect(Array.isArray(result.first.left)).toBe(true);
    expect(result.first.left).toEqual([1]);
    expect((row.reference.trace as unknown[][]).map((event) => event[0])).toEqual([
      "onAnchor",
      "onAnchor",
    ]);
    expect((row.reference.trace as unknown[][]).map((event) => event[2])).toEqual([2, 2]);
    const candidateObservation = (row.candidate.docs?.[0] as Record<string, unknown>)
      .toJSONAnchorObservation as Observation;
    expect(candidateObservation.calls).toEqual([]);
    expect(compareGraph(result, candidateObservation.result).equal).toBe(true);
    expect(row.differences.map(({ category }) => category)).toContain(
      "document-semantic",
    );
    const persisted = decodeGraph(encodeGraph(observation)) as Observation;
    expect(persisted.result.first).toBe(persisted.result.second);
    expect(persisted.calls[0]?.[0]).toBe(persisted.result.first);
    expect(persisted.calls[1]?.[0]).toBe(persisted.result.first.left);
    const detachedCalls = calls.map((args) => [
      JSON.parse(JSON.stringify(args[0])),
      args[1],
    ]);
    expect(
      compareGraph({ result, calls: detachedCalls }, { result, calls }),
    ).toMatchObject({ equal: false });
  });

  test("versioned toJSON callback observation stays empty when callback is absent", () => {
    const descriptor = {
      ...optionWitnesses().find(
        (row) => row.id === "document-toJSON-onAnchor-v1",
      )!,
      conversionOptions: { values: {} },
    };
    const row = evaluate(descriptor);
    for (const outcome of [row.reference, row.candidate]) {
      const observation = (outcome.docs?.[0] as Record<string, unknown>)
        .toJSONAnchorObservation;
      expect((observation as { calls: unknown[][] }).calls).toEqual([]);
    }
    expect(row.differences.map(({ category }) => category)).not.toContain(
      "document-semantic",
    );
  });

  test("saved conversionOptions onAnchor descriptors keep legacy repeated toJS tracing", () => {
    const row = evaluate({
      id: "saved-conversion-onAnchor",
      operation: "parseDocument",
      text: "first: &outer\n  left: &inner [1]\n  right: *inner\nsecond: *outer\n",
      options: { values: {} },
      conversionOptions: { values: {}, callback: "onAnchor" },
      source: "legacy-replay",
      categories: ["document-conversion", "callback"],
    });
    expect(row.reference.trace).toHaveLength(6);
    expect((row.reference.trace as unknown[][]).map((event) => event[0])).toEqual(
      Array(6).fill("onAnchor"),
    );
    expect((row.reference.trace as unknown[][]).map((event) => event[2])).toEqual(
      [2, 2, 2, 2, 2, 2],
    );
    expect(row.candidate.trace).toEqual([]);
    expect(row.reference.docs?.[0]).not.toHaveProperty(
      "toJSONAnchorObservation",
    );
  });
  test("every option and behavior witness produces a replayable outcome", () => {
    for (const descriptor of [...optionWitnesses(), ...behaviorWitnesses()]) {
      const first = evaluate(descriptor);
      const second = evaluate(descriptor);
      expect(first.reference.status, descriptor.id).toBe(
        second.reference.status,
      );
      expect(first.candidate.status, descriptor.id).toBe(
        second.candidate.status,
      );
      expect(first.differences, descriptor.id).toEqual(second.differences);
      expect(first.reference.error, descriptor.id).toEqual(
        second.reference.error,
      );
      expect(first.candidate.error, descriptor.id).toEqual(
        second.candidate.error,
      );
      expect(first.reference.trace, descriptor.id).toEqual(
        second.reference.trace,
      );
      expect(first.candidate.trace, descriptor.id).toEqual(
        second.candidate.trace,
      );
    }
  });
  test("finite named bases are exhaustive and unique", () => {
    const bases = finiteBases();
    expect(bases.parse).toHaveLength(512);
    expect(
      new Set(bases.parse.map((x) => JSON.stringify(x.options.values))).size,
    ).toBe(512);
    expect(bases.stringify).toHaveLength(1024);
    expect(
      new Set(bases.stringify.map((x) => JSON.stringify(x.options.values)))
        .size,
    ).toBe(1024);
    expect(bases.enum).toHaveLength(108);
    expect(
      new Set(bases.enum.map((x) => JSON.stringify(x.options.values))).size,
    ).toBe(108);
  });
});
