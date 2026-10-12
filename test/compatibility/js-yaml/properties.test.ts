import { test } from "@fast-check/vitest";
import fc from "fast-check";
import { describe, expect } from "vitest";
import type { CaseDescriptor, Operation } from "./types.js";
import { evaluate } from "./evaluate.js";
import { compareGraph, decodeGraph, encodeGraph } from "../shared/graph.js";
import { fullBooleanBasis, graphArb, textArb } from "./generators.js";
import * as jsYamlReference from "js-yaml";
import { load, loadAll, YAMLException } from "../../../src/js-yaml-compat.ts";

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

  const eolArb = fc.constantFrom("\n", "\r\n");
  const triviaArb = fc.array(
    fc.constantFrom("", " ", "  ", "# comment", "\t# c"),
    { maxLength: 5 },
  );
  const suffixArb = fc.array(
    fc.constantFrom("...", "... # suffix"),
    { maxLength: 5 },
  );
  const noDocumentStreamArb = fc.record({
    bom: fc.boolean(),
    eol: eolArb,
    trivia: triviaArb,
    suffixes: suffixArb,
  }).map(({ bom, eol, trivia, suffixes }) => {
    const lines = [...trivia, ...suffixes];
    return (bom ? "\ufeff" : "") + (lines.length ? lines.join(eol) + eol : "");
  });

  test("generated empty streams reject load and preserve loadAll callback behavior", () => {
    fc.assert(
      fc.property(noDocumentStreamArb, (text) => {
        let referenceError: unknown;
        try {
          jsYamlReference.load(text);
        } catch (error) {
          referenceError = error;
        }
        expect(referenceError).toBeInstanceOf(jsYamlReference.YAMLException);
        expect((referenceError as jsYamlReference.YAMLException).reason).toBe(
          "expected a document, but the input is empty",
        );

        let candidateError: unknown;
        try {
          load(text);
        } catch (error) {
          candidateError = error;
        }
        expect(candidateError).toBeInstanceOf(YAMLException);
        expect((candidateError as YAMLException).reason).toBe(
          "expected a document, but the input is empty",
        );
        expect(jsYamlReference.loadAll(text)).toEqual([]);
        expect(loadAll(text)).toEqual([]);
        const referenceTrace: unknown[] = [];
        const candidateTrace: unknown[] = [];
        expect(jsYamlReference.loadAll(text, (value) => { referenceTrace.push(value); })).toBeUndefined();
        expect(loadAll(text, (value) => { candidateTrace.push(value); })).toBeUndefined();
        expect(referenceTrace).toEqual([]);
        expect(candidateTrace).toEqual([]);
      }),
      { numRuns: 150, seed: 132 },
    );
  });

  const nullSpellingArb = fc.constantFrom("", "null", "Null", "NULL", "~");
  const suffixLines = (eol: string, suffixes: string[]) =>
    suffixes.length ? eol + suffixes.join(eol) : "";
  const explicitNullStreamArb = fc.record({
    bom: fc.boolean(),
    eol: eolArb,
    trivia: triviaArb,
    directive: fc.boolean(),
    spelling: nullSpellingArb,
    suffixes: suffixArb,
  }).map(({ bom, eol, trivia, directive, spelling, suffixes }) => {
    const lines = [...trivia, ...(directive ? ["%YAML 1.2"] : []), "---"];
    if (spelling) lines.push(spelling);
    const tail = suffixLines(eol, suffixes);
    return (bom ? "\ufeff" : "") + lines.join(eol) + eol + tail + (tail ? eol : "");
  });

  test("generated explicit null documents remain distinct from empty streams", () => {
    fc.assert(
      fc.property(explicitNullStreamArb, (text) => {
        expect(jsYamlReference.load(text)).toBeNull();
        expect(load(text)).toBeNull();
        expect(jsYamlReference.loadAll(text)).toEqual([null]);
        expect(loadAll(text)).toEqual([null]);
        const referenceTrace: unknown[] = [];
        const candidateTrace: unknown[] = [];
        jsYamlReference.loadAll(text, (value) => { referenceTrace.push(value); });
        loadAll(text, (value) => { candidateTrace.push(value); });
        expect(referenceTrace).toEqual([null]);
        expect(candidateTrace).toEqual([null]);
      }),
      { numRuns: 150, seed: 2132 },
    );
  });

  test("generated explicit null document pairs reject load and retain both documents", () => {
    fc.assert(
      fc.property(eolArb, suffixArb, suffixArb, (eol, between, trailing) => {
        const first = "---" + eol + "null" + suffixLines(eol, between);
        const second = "---" + eol + "null" + suffixLines(eol, trailing) + eol;
        const text = first + eol + second;
        expect(() => jsYamlReference.load(text)).toThrow(jsYamlReference.YAMLException);
        expect(() => load(text)).toThrow(YAMLException);
        expect(jsYamlReference.loadAll(text)).toEqual([null, null]);
        expect(loadAll(text)).toEqual([null, null]);
        const referenceTrace: unknown[] = [];
        const candidateTrace: unknown[] = [];
        jsYamlReference.loadAll(text, (value) => { referenceTrace.push(value); });
        loadAll(text, (value) => { candidateTrace.push(value); });
        expect(referenceTrace).toEqual([null, null]);
        expect(candidateTrace).toEqual([null, null]);
      }),
      { numRuns: 120, seed: 1320 },
    );
  });

  test("a long suffix-only stream does not create documents or recurse per suffix", () => {
    const text = "...\n".repeat(1000) + "...";
    expect(jsYamlReference.loadAll(text)).toEqual([]);
    expect(loadAll(text)).toEqual([]);
    expect(() => load(text)).toThrow(YAMLException);
  });
});
