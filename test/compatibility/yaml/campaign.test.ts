import { describe, expect, it } from "vitest";
import { encodeGraph } from "../shared/graph.js";
import { compareGraph } from "../shared/graph.js";
import { loadComposedCorpus } from "./corpus.js";
import { buildCorpusParseDescriptors, buildCorpusReferenceSerializationDescriptor } from "./campaign.js";
import { evaluate } from "./evaluate.js";
import * as yamlReference from "yaml";
import { parseDocument as candidateParseDocument, parseAllDocuments as candidateParseAllDocuments } from "../../../src/yaml-compat.ts";
import {
  isUnsupportedGraphCodecError,
  parseReplayDescriptor,
  summarize,
} from "./campaign.js";
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
  it("schedules all three files through every parse lane and accepted reference serialization", async () => {
    const additions = (await loadComposedCorpus()).filter((input) => input.corpusKind === "real-world");
    expect(additions).toHaveLength(3);
    const descriptors = buildCorpusParseDescriptors(additions);
    expect(descriptors).toHaveLength(additions.length * 3);
    for (const input of additions) {
      const lanes = descriptors.filter((descriptor) => descriptor.source === input.source);
      expect(lanes.map((descriptor) => descriptor.operation)).toEqual([
        "parse", "parseDocument", "parseAllDocuments",
      ]);
      const evaluated = lanes.map(evaluate);
      for (const row of evaluated) {
        expect(row.reference.status, `${input.id} ${row.descriptor.operation} reference`).toBe("success");
        expect(row.candidate.status, `${input.id} ${row.descriptor.operation} candidate`).toBe("success");
      }
      const parseRow = evaluated[0]!;
      expect(compareGraph(parseRow.reference.value, parseRow.candidate.value).equal).toBe(true);
      expect(compareGraph(
        yamlReference.parseDocument(input.text).toJS(),
        candidateParseDocument(input.text).toJS(),
      ).equal).toBe(true);
      expect(compareGraph(
        yamlReference.parseAllDocuments(input.text).map((document) => document.toJS()),
        candidateParseAllDocuments(input.text).map((document) => document.toJS()),
      ).equal).toBe(true);
      const serializedDescriptor = buildCorpusReferenceSerializationDescriptor(
        lanes[0]!, parseRow.reference.value,
      );
      const serialized = evaluate(serializedDescriptor);
      expect(serialized.reference.status).toBe("success");
      expect(serialized.candidate.status).toBe("success");
      const roundTrip = evaluate({
        ...lanes[0]!,
        id: `${lanes[0]!.id}-serialization-roundtrip`,
        text: String(serialized.candidate.text),
      });
      expect(roundTrip.reference.status).toBe("success");
      expect(compareGraph(parseRow.reference.value, roundTrip.reference.value).equal).toBe(true);
      expect(serialized.semantic?.equal).toBe(true);
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
