import { describe, expect, it } from "vitest";
import { summarize } from "./campaign.js";
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
