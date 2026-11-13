import { test } from "@fast-check/vitest";
import fc from "fast-check";
import * as jsYamlReference from "js-yaml";
import * as yamlReference from "yaml";
import { describe, expect } from "vitest";
import { load, loadAll } from "../../../src/js-yaml-compat.ts";
import {
  parse,
  parseAllDocuments,
  parseDocument,
} from "../../../src/yaml-compat.ts";
import { compareGraph } from "./graph.js";

type Payload = {
  suffix: number;
  number: number;
  flag: boolean;
  text: string;
  numbers: number[];
};

const payloadArb: fc.Arbitrary<Payload> = fc.record({
  suffix: fc.integer({ min: 0, max: 999 }),
  number: fc.integer({ min: -100, max: 100 }),
  flag: fc.boolean(),
  text: fc.array(fc.constantFrom("a", "Z", "0", " ", "-", "_", ":"), {
    maxLength: 12,
  }).map((chars) => chars.join("")),
  numbers: fc.array(fc.integer({ min: -10, max: 10 }), { maxLength: 4 }),
});

function render(payload: Payload, mapFlow: boolean, sequenceFlow: boolean, eol: string) {
  const { suffix, number, flag, text, numbers } = payload;
  const map = `{number: ${number}, flag: ${flag}, text: ${JSON.stringify(text)}, nil: null}`;
  const blockMap = [
    `base: &m${suffix}`,
    `  number: ${number}`,
    `  flag: ${flag}`,
    `  text: ${JSON.stringify(text)}`,
    "  nil: null",
  ].join(eol);
  const items = sequenceFlow
    ? `items: &s${suffix} [*m${suffix}, {numbers: [${numbers.join(", ")}]}]`
    : [
        `items: &s${suffix}`,
        `  - *m${suffix}`,
        `  - numbers: [${numbers.join(", ")}]`,
      ].join(eol);
  const copies = `[${map}, ${map}]`;
  return [
    mapFlow ? `base: &m${suffix} ${map}` : blockMap,
    items,
    `mapAgain: *m${suffix}`,
    `itemsAgain: *s${suffix}`,
    `copies: ${copies}`,
  ].join(eol) + eol;
}

function expected(payload: Payload) {
  const base = {
    number: payload.number,
    flag: payload.flag,
    text: payload.text,
    nil: null,
  };
  const items = [base, { numbers: [...payload.numbers] }];
  const copy = () => ({
    number: payload.number,
    flag: payload.flag,
    text: payload.text,
    nil: null,
  });
  return { base, items, mapAgain: base, itemsAgain: items, copies: [copy(), copy()] };
}

function assertGraph(actualValue: unknown, model: ReturnType<typeof expected>) {
  expect(actualValue).toStrictEqual({
    base: model.base,
    items: model.items,
    mapAgain: model.mapAgain,
    itemsAgain: model.itemsAgain,
    copies: model.copies,
  });
  const actual = actualValue as typeof model;
  expect(Object.getPrototypeOf(actual.base)).toBe(Object.prototype);
  expect(Array.isArray(actual.items)).toBe(true);
  expect(Object.getPrototypeOf(actual.items)).toBe(Array.prototype);
  expect(Object.getPrototypeOf(actual.items[1])).toBe(Object.prototype);
  expect(typeof actual.base.number).toBe("number");
  expect(typeof actual.base.flag).toBe("boolean");
  expect(typeof actual.base.text).toBe("string");
  expect(actual.base.nil).toBeNull();
  expect(actual.mapAgain).toBe(actual.base);
  expect(actual.itemsAgain).toBe(actual.items);
  expect(actual.items[0]).toBe(actual.base);
  expect(actual.copies[0]).not.toBe(actual.copies[1]);
  expect(actual.copies[0]).not.toBe(actual.base);
  expect(actual.copies[1]).not.toBe(actual.base);
  expect(compareGraph(actualValue, model).equal).toBe(true);
}

function assertPair(candidate: unknown, reference: unknown, model: ReturnType<typeof expected>) {
  assertGraph(candidate, model);
  assertGraph(reference, model);
  expect(compareGraph(candidate, reference).equal).toBe(true);
}

function assertClean(documents: { errors: unknown[] }[]) {
  for (const document of documents) expect(document.errors).toEqual([]);
}

describe("generated parse alias graphs", () => {
  test.prop([payloadArb, fc.constantFrom("\n", "\r\n")], {
    numRuns: 100,
    seed: 70115,
  })(
    "all parse entry points preserve shared and distinct containers",
    (payload, eol) => {
      for (const mapFlow of [false, true]) {
        for (const sequenceFlow of [false, true]) {
          const text = render(payload, mapFlow, sequenceFlow, eol);
          const model = expected(payload);

          assertPair(load(text), jsYamlReference.load(text), model);
          const loaded = loadAll(text);
          const referenceLoaded = jsYamlReference.loadAll(text);
          expect(loaded).toHaveLength(1);
          expect(referenceLoaded).toHaveLength(1);
          assertPair(loaded![0], referenceLoaded[0], model);

          assertPair(parse(text), yamlReference.parse(text), model);
          const document = parseDocument(text);
          const referenceDocument = yamlReference.parseDocument(text);
          assertClean([document, referenceDocument]);
          assertPair(document.toJS(), referenceDocument.toJS(), model);
          const documents = parseAllDocuments(text);
          const referenceDocuments = yamlReference.parseAllDocuments(text);
          expect(documents).toHaveLength(1);
          expect(referenceDocuments).toHaveLength(1);
          assertClean(documents);
          assertClean(referenceDocuments);
          assertPair(
            documents[0].toJS(),
            referenceDocuments[0].toJS(),
            model,
          );

          const loadAgain = load(text);
          const parseAgain = parse(text);
          const nextLoad = load(text);
          const nextParse = parse(text);
          assertGraph(loadAgain, model);
          assertGraph(parseAgain, model);
          assertGraph(nextLoad, model);
          assertGraph(nextParse, model);
          expect(loadAgain).not.toBe(nextLoad);
          expect(parseAgain).not.toBe(nextParse);
          for (const [first, next] of [
            [loadAgain, nextLoad],
            [parseAgain, nextParse],
          ]) {
            expect((first as typeof model).base).not.toBe(
              (next as typeof model).base,
            );
            expect((first as typeof model).items).not.toBe(
              (next as typeof model).items,
            );
          }
        }
      }
    },
  );

  test.prop([payloadArb, payloadArb, fc.constantFrom("\n", "\r\n")], {
    numRuns: 100,
    seed: 70116,
  })(
    "reused anchor names stay local to each document",
    (first, second, eol) => {
      second = { ...second, suffix: first.suffix };
      const firstText = render(first, true, true, eol);
      const secondText = render(second, false, false, eol);
      const stream = `${firstText}---${eol}${secondText}`;
      const models = [expected(first), expected(second)];

      const candidateLoaded = loadAll(stream);
      const referenceLoaded = jsYamlReference.loadAll(stream);
      expect(candidateLoaded).toHaveLength(2);
      expect(referenceLoaded).toHaveLength(2);
      candidateLoaded!.forEach((value, index) =>
        assertPair(value, referenceLoaded[index], models[index]),
      );

      const candidateDocs = parseAllDocuments(stream);
      const referenceDocs = yamlReference.parseAllDocuments(stream);
      expect(candidateDocs).toHaveLength(2);
      expect(referenceDocs).toHaveLength(2);
      assertClean(candidateDocs);
      assertClean(referenceDocs);
      candidateDocs.forEach((document, index) =>
        assertPair(
          document.toJS(),
          referenceDocs[index].toJS(),
          models[index],
        ),
      );
      for (const values of [candidateLoaded!, candidateDocs.map((doc) => doc.toJS())]) {
        expect((values[0] as typeof models[number]).base).not.toBe(
          (values[1] as typeof models[number]).base,
        );
        expect((values[0] as typeof models[number]).items).not.toBe(
          (values[1] as typeof models[number]).items,
        );
      }
    },
  );

  test("the topology assertion rejects a lost alias on parsed output", () => {
    const model = expected({ suffix: 1, number: 2, flag: true, text: "x", numbers: [] });
    const actual = parse(render(
      { suffix: 1, number: 2, flag: true, text: "x", numbers: [] },
      true,
      true,
      "\n",
    )) as typeof model;
    assertGraph(actual, model);
    actual.mapAgain = { ...actual.base };
    expect(() => assertGraph(actual, model)).toThrow();
  });
});
