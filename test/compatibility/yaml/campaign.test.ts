import { describe, expect, it } from "vitest";
import { compareGraph, decodeGraph, encodeGraph } from "../shared/graph.js";
import { loadRealWorldCorpus } from "../shared/realWorldCorpus.js";
import {
  buildCorpusParseDescriptors,
  buildCorpusReferenceSerializationDescriptor,
  descriptorExplicitUndefinedKeys,
  descriptorOptionKeys,
  isUnsupportedGraphCodecError,
  parseReplayDescriptor,
  summarize,
} from "./campaign.js";
import { evaluate } from "./evaluate.js";
import { optionWitnesses } from "./witnesses.js";
import * as yamlReference from "yaml";
import { parseDocument as candidateParseDocument, parseAllDocuments as candidateParseAllDocuments, stringify as candidateStringify } from "../../../src/yaml-compat.ts";
import { parseAll as nativeParseAll, stringify as nativeStringify } from "../../../src/core.ts";
import type { CaseResult } from "./types.js";

function row(
  operation: "parse" | "parseDocument" | "parseAllDocuments" | "stringify",
  reference: CaseResult["reference"],
  candidate: CaseResult["candidate"],
  categories: string[] = [],
): CaseResult {
  return {
    descriptor: {
      id: `test-${operation}`,
      operation,
      options: { values: {} },
      source: "test",
      categories,
    },
    reference,
    candidate,
    differences: [],
  };
}

describe("YAML campaign metric denominators", () => {
  it("replays the versioned active onTagObj witness with measured callback gaps", () => {
    const scheduled = optionWitnesses().find(
      (descriptor) => descriptor.options.callback === "onTagObj-declarative-v1",
    )!;
    const replayed = parseReplayDescriptor(
      JSON.parse(JSON.stringify(scheduled)),
    );
    const result = evaluate(replayed);
    const again = evaluate(replayed);
    expect(result.reference).toEqual(again.reference);
    expect(result.candidate).toEqual(again.candidate);
    expect(result.differences).toEqual(again.differences);
    expect(result.reference.status).toBe("success");
    expect(result.reference.text).toBe("null\n");
    expect(result.reference.trace).toEqual([
      ["onTagObj", { tag: "tag:yaml.org,2002:null", default: true }],
    ]);
    expect(compareGraph(
      result.reference.trace,
      decodeGraph(encodeGraph(result.reference.trace)),
    ).equal).toBe(true);
    expect(result.candidate.status).toBe("error");
    expect(result.differences.map(({ category }) => category).sort()).toEqual([
      "acceptance",
      "callback",
      "stringify-semantic",
    ]);

    const metrics = summarize([result]);
    expect(metrics.callbackDifferences).toEqual({ numerator: 1, denominator: 1, percent: 100 });
    expect(metrics.stringifyCallFailures).toEqual({ numerator: 1, denominator: 1, percent: 100 });
    expect(metrics.stringifySemanticGaps).toEqual({ numerator: 1, denominator: 1, percent: 100 });
    expect(metrics.stringifyByteDifferences).toEqual({ numerator: 0, denominator: 0, percent: null });
    expect(metrics.stringifyByteEquality).toEqual({ numerator: 0, denominator: 0, percent: null });
  });

  it("preserves legacy onTagObj replay behavior and validates recipe names", () => {
    const legacy = parseReplayDescriptor(JSON.parse(JSON.stringify({
      id: "callback-stringify-onTagObj-onTagObj",
      operation: "stringify",
      valueRecipe: "custom-value-input",
      options: { values: {}, callback: "onTagObj" },
      source: "legacy-replay",
      categories: ["options", "matrix"],
    })));
    const result = evaluate(legacy);
    expect(result.reference.error).toEqual({
      name: "TypeError",
      message: "Cannot encode graph: function",
    });
    expect(result.reference.trace).toEqual([]);
    expect(() => parseReplayDescriptor({
      ...legacy,
      options: { values: {}, callback: "unknown-recipe" },
    })).toThrow("valid case descriptor");
  });

  it("counts conversion-only callbacks and routes both option sets to the ledger", () => {
    const descriptor = optionWitnesses().find(
      (entry) => entry.id === "document-toJSON-onAnchor-v1",
    )!;
    const replayed = parseReplayDescriptor(JSON.parse(JSON.stringify(descriptor)));
    const result = evaluate(replayed);
    const metrics = summarize([result]);
    expect(metrics.callbackDifferences).toEqual({
      numerator: 1,
      denominator: 1,
      percent: 100,
    });
    expect(descriptorOptionKeys(replayed)).toEqual(["onAnchor"]);
    expect(descriptorExplicitUndefinedKeys({
      ...replayed,
      options: { values: {}, undefinedKeys: ["strict"] },
      conversionOptions: { values: {}, undefinedKeys: ["maxAliasCount"] },
    })).toEqual(["maxAliasCount", "strict"]);
    expect(descriptorExplicitUndefinedKeys({
      ...replayed,
      options: { values: {}, undefinedKeys: ["strict", "uniqueKeys"] },
      conversionOptions: undefined,
    })).toEqual(["strict", "uniqueKeys"]);
  });

  it("rejects incompatible settings for the versioned positional toJSON call", () => {
    const descriptor = optionWitnesses().find(
      (entry) => entry.id === "document-toJSON-onAnchor-v1",
    )!;
    expect(() => parseReplayDescriptor({
      ...descriptor,
      operation: "parseAllDocuments",
    })).toThrow("valid case descriptor");
    expect(() => parseReplayDescriptor({
      ...descriptor,
      conversionOptions: { values: { maxAliasCount: 1 }, callback: "onAnchor" },
    })).toThrow("valid case descriptor");
    expect(() => parseReplayDescriptor({
      ...descriptor,
      conversionOptions: { values: {}, callback: "onAnchor", schema: "core" },
    })).toThrow("valid case descriptor");
    expect(() => parseReplayDescriptor({
      ...descriptor,
      conversionOptions: { values: {}, callback: "onAnchor", undefinedKeys: ["strict"] },
    })).toThrow("valid case descriptor");
    expect(parseReplayDescriptor({
      ...descriptor,
      conversionOptions: { values: {} },
    }).call).toBe("document-toJSON-onAnchor-v1");
  });

  it("counts candidate stringify failures in byte-call denominators without inventing byte equality", () => {
    const result = summarize([
      row(
        "stringify",
        { status: "success", text: "a: 1\n", trace: [] },
        { status: "error", trace: [] },
      ),
    ]);
    expect(result.stringifyCallFailures).toEqual({
      numerator: 1,
      denominator: 1,
      percent: 100,
    });
    expect(result.stringifyByteDifferences).toEqual({
      numerator: 0,
      denominator: 0,
      percent: null,
    });
    expect(result.stringifyByteEquality).toEqual({
      numerator: 0,
      denominator: 0,
      percent: null,
    });
  });

  it("keeps undefined stringify returns outside byte comparison and tracks their return contract", () => {
    const result = summarize([
      row(
        "stringify",
        { status: "success", text: undefined, trace: [] },
        { status: "success", text: "null\n", trace: [] },
      ),
    ]);
    expect(result.stringifyReferenceUndefined).toEqual({
      numerator: 1,
      denominator: 1,
      percent: 100,
    });
    expect(result.stringifyUndefinedContractGaps).toEqual({
      numerator: 1,
      denominator: 1,
      percent: 100,
    });
    expect(result.stringifyByteDifferences).toEqual({
      numerator: 0,
      denominator: 0,
      percent: null,
    });
    expect(result.stringifyByteEquality).toEqual({
      numerator: 0,
      denominator: 0,
      percent: null,
    });
  });

  it("counts rejection disagreements only when a reference error is accepted by the candidate", () => {
    const result = summarize([
      row(
        "parse",
        { status: "error", trace: [] },
        { status: "success", value: 1, trace: [] },
      ),
      row(
        "parse",
        { status: "error", trace: [] },
        { status: "error", trace: [] },
      ),
      row(
        "parse",
        { status: "success", value: 1, trace: [] },
        { status: "error", trace: [] },
      ),
    ]);
    expect(result.rejectionDisagreements).toEqual({
      numerator: 1,
      denominator: 2,
      percent: 50,
    });
    expect(result.parseAcceptanceFailures).toEqual({
      numerator: 1,
      denominator: 1,
      percent: 100,
    });
  });
});

describe("YAML campaign real-world corpus scheduling", () => {
  it("schedules every real-world source across parse lanes and accepted document serialization", async () => {
    const additions = (await loadRealWorldCorpus()).map((input) => ({
      ...input,
      corpusKind: "real-world" as const,
    }));
    const descriptors = buildCorpusParseDescriptors(additions);
    expect(new Set(descriptors.map((descriptor) => descriptor.source))).toEqual(
      new Set(additions.map((input) => input.source)),
    );
    for (const input of additions) {
      const lanes = descriptors.filter((descriptor) => descriptor.source === input.source);
      expect(lanes.map((descriptor) => descriptor.operation)).toEqual([
        "parse", "parseDocument", "parseAllDocuments",
      ]);
      expect(lanes.map((descriptor) => descriptor.categories)).toEqual([
        ["corpus", "real-world", input.category, "parse"],
        ["corpus", "real-world", input.category, "parseDocument"],
        ["corpus", "real-world", input.category, "parseAllDocuments"],
      ]);
      const referenceDocuments = yamlReference.parseAllDocuments(input.text);
      const referenceGraphs = referenceDocuments.map((document) => document.toJS());
      const results = lanes.map(evaluate);
      const parse = results[0]!;
      if (referenceGraphs.length > 1) {
        expect(yamlReference.parseDocument(input.text).errors.length).toBeGreaterThan(0);
        expect(() => yamlReference.parse(input.text)).toThrow();
        expect(parse.reference.status, `${input.id} parse reference`).toBe("error");
        expect(parse.candidate.status, `${input.id} parse candidate`).toBe("error");
      } else {
        expect(parse.reference.status).toBe("success");
        expect(parse.candidate.status).toBe("success");
        expect(compareGraph(parse.reference.value, parse.candidate.value).equal).toBe(true);
      }
      const docResult = results[1]!;
      expect(docResult.reference.status).toBe("success");
      expect(docResult.candidate.status).toBe("success");
      expect(yamlReference.parseDocument(input.text).errors.length > 0)
        .toBe(candidateParseDocument(input.text).errors.length > 0);
      const streamResult = results[2]!;
      expect(streamResult.reference.status).toBe("success");
      expect(streamResult.candidate.status).toBe("success");
      expect(streamResult.reference.value).toHaveLength(referenceGraphs.length);
      expect(streamResult.candidate.value).toHaveLength(referenceGraphs.length);
      expect(compareGraph(referenceGraphs, nativeParseAll(input.text)).equal).toBe(true);
      expect(compareGraph(
        referenceGraphs,
        candidateParseAllDocuments(input.text).map((document) => document.toJS()),
      ).equal).toBe(true);

      for (const value of referenceGraphs) {
        const serialized = candidateStringify(value);
        expect(compareGraph(value, yamlReference.parse(serialized)).equal).toBe(true);
        expect(compareGraph(value, yamlReference.parse(nativeStringify(value))).equal).toBe(true);
        const stringifyDescriptor = buildCorpusReferenceSerializationDescriptor(lanes[0]!, value);
        expect(stringifyDescriptor.source).toBe(`corpus-reference-value/${input.source}`);
        expect(stringifyDescriptor.categories).toEqual([
          "corpus-reference-value", "stringify", "real-world", input.category,
        ]);
        const stringifyResult = evaluate(stringifyDescriptor);
        expect(stringifyResult.reference.status).toBe("success");
        expect(stringifyResult.candidate.status).toBe("success");
        expect(stringifyResult.semantic?.equal).toBe(true);
      }
    }
  });

  it("keeps legacy reference-derived stringify categories stable", () => {
    const legacy = {
      id: "legacy-corpus-parse", operation: "parse" as const, text: "a: 1\n",
      options: { values: {} }, source: "bench/yaml-test-suite/data/example/in.yaml",
      categories: ["corpus"],
    };
    expect(buildCorpusReferenceSerializationDescriptor(legacy, { a: 1 }).categories)
      .toEqual(["corpus-reference-value", "stringify"]);
  });
});


describe("campaign input error handling", () => {
  it("counts only expected unsupported-value errors from the graph codec", () => {
    let unsupported: unknown;
    try {
      encodeGraph({ [Symbol("unsupported")]: true });
    } catch (error) {
      unsupported = error;
    }
    expect(isUnsupportedGraphCodecError(unsupported)).toBe(true);
    expect(
      isUnsupportedGraphCodecError(new TypeError("Cannot read property")),
    ).toBe(false);
    expect(
      isUnsupportedGraphCodecError(
        new Error("Cannot encode graph: symbol properties"),
      ),
    ).toBe(false);
  });

  it("rejects replay descriptors missing operation-specific inputs", () => {
    expect(() =>
      parseReplayDescriptor({
        id: "invalid",
        operation: "parse",
        options: { values: {} },
        source: "test",
        categories: [],
      }),
    ).toThrow("valid case descriptor");
    expect(
      parseReplayDescriptor({
        id: "valid",
        operation: "parse",
        text: "key: value",
        options: { values: {} },
        source: "test",
        categories: [],
      }).text,
    ).toBe("key: value");
  });
});
