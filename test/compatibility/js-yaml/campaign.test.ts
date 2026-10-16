import { expect, test } from "vitest";
import { encodeGraph } from "../shared/graph.js";
import { evaluate } from "./evaluate.js";
import { summarize } from "./campaign.js";
import { buildCorpusDescriptors, buildReferenceDumpDescriptor } from "./campaign.js";
import { loadComposedCorpus } from "../shared/corpus.js";
import { compareGraph } from "../shared/graph.js";

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

test("every real-world input receives load, stream, and reference-derived dump descriptors", async () => {
  const additions = (await loadComposedCorpus()).filter((input) => input.corpusKind === "real-world");
  expect(additions).toHaveLength(3);
  const descriptors = buildCorpusDescriptors(additions);
  expect(descriptors).toHaveLength(additions.length * 2);
  for (const input of additions) {
    const lanes = descriptors.filter((descriptor) => descriptor.source === input.source);
    expect(lanes.map((descriptor) => descriptor.operation)).toEqual(["load", "loadAll-array"]);
    for (const descriptor of lanes) {
      const row = evaluate(descriptor);
      expect(row.reference.status, `${input.id} ${descriptor.operation} reference`).toBe("success");
      expect(row.candidate.status, `${input.id} ${descriptor.operation} candidate`).toBe("success");
      expect(compareGraph(row.reference.value, row.candidate.value).equal).toBe(true);
    }
    const load = lanes[0]!;
    const accepted = evaluate(load).reference.value;
    const serialized = buildReferenceDumpDescriptor(load, accepted);
    const result = evaluate(serialized);
    expect(result.reference.status).toBe("success");
    expect(result.candidate.status).toBe("success");
    expect(result.semantic?.equal).toBe(true);
    const roundTrip = evaluate({
      ...load,
      id: `${load.id}-dump-roundtrip`,
      text: result.candidate.text,
    });
    expect(roundTrip.reference.status).toBe("success");
    expect(compareGraph(accepted, roundTrip.reference.value).equal).toBe(true);
    expect(compareGraph(result.reference.value, result.candidate.value).equal).toBe(true);
  }
});

test("legacy dump descriptor categories stay stable and unsupported graphs remain ineligible", () => {
  const legacy = {
    id: "legacy-corpus-load", operation: "load" as const, text: "a: 1\n",
    options: { values: {} }, source: "bench/yaml-test-suite/data/example/in.yaml",
    categories: ["corpus"],
  };
  expect(buildReferenceDumpDescriptor(legacy, { a: 1 }).categories).toEqual(["corpus-dump"]);
  const unsupported = Object.defineProperty({}, "hidden", { get: () => 1, enumerable: true });
  expect(() => buildReferenceDumpDescriptor(legacy, unsupported)).toThrow(/Cannot encode graph/);
});
