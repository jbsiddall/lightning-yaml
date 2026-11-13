import { expect, test } from "vitest";
import { compareGraph, encodeGraph } from "../shared/graph.js";
import { evaluate } from "./evaluate.js";
import {
  buildCorpusDescriptors,
  buildReferenceDumpDescriptor,
  summarize,
} from "./campaign.js";
import { loadRealWorldCorpus } from "../shared/realWorldCorpus.js";
import * as jsYamlReference from "js-yaml";

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

test("every real-world input receives the applicable load, stream, and dump lanes", async () => {
  const additions = (await loadRealWorldCorpus()).map((input) => ({
    ...input,
    corpusKind: "real-world" as const,
  }));
  const descriptors = buildCorpusDescriptors(additions);
  expect(new Set(descriptors.map((descriptor) => descriptor.source))).toEqual(
    new Set(additions.map((input) => input.source)),
  );
  for (const input of additions) {
    const lanes = descriptors.filter((descriptor) => descriptor.source === input.source);
    expect(lanes.map((descriptor) => descriptor.operation)).toEqual(["load", "loadAll-array"]);
    expect(lanes.map((descriptor) => descriptor.categories)).toEqual([
      ["corpus", "real-world", input.category],
      ["corpus", "real-world", input.category, "loadAll"],
    ]);
    const load = lanes[0]!;
    const stream = lanes[1]!;
    const streamValues: unknown[] = [];
    jsYamlReference.loadAll(input.text, (value) => streamValues.push(value));
    const single = evaluate(load);
    const streamed = evaluate(stream);
    expect(streamed.reference.status, `${input.id} loadAll reference`).toBe("success");
    expect(streamed.candidate.status, `${input.id} loadAll candidate`).toBe("success");
    expect(compareGraph(streamValues, streamed.reference.value).equal).toBe(true);
    expect(compareGraph(streamed.reference.value, streamed.candidate.value).equal).toBe(true);
    if (streamValues.length > 1) {
      expect(single.reference.status, `${input.id} load reference`).toBe("error");
      expect(single.candidate.status, `${input.id} load candidate`).toBe("error");
      continue;
    }
    expect(single.reference.status).toBe("success");
    expect(single.candidate.status).toBe("success");
    expect(compareGraph(single.reference.value, single.candidate.value).equal).toBe(true);
    const dumpDescriptor = buildReferenceDumpDescriptor(load, single.reference.value);
    expect(dumpDescriptor.source).toBe(`corpus-dump/${input.source}`);
    expect(dumpDescriptor.categories).toEqual(["corpus-dump", "real-world", input.category]);
    const serialized = evaluate(dumpDescriptor);
    expect(serialized.reference.status).toBe("success");
    expect(serialized.candidate.status).toBe("success");
    expect(serialized.semantic?.equal).toBe(true);
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
