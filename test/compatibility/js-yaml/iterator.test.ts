import { test } from "@fast-check/vitest";
import fc from "fast-check";
import { describe, expect } from "vitest";
import * as jsYamlReference from "js-yaml";
import { loadAll } from "../../../src/js-yaml-compat.ts";

type ExpectedDocument = { index: number; value: unknown };
type Outcome =
  | { status: "returned"; value: unknown }
  | { status: "threw"; error: unknown };
type LoadAllIterator = (
  text: string,
  iterator: (document: unknown) => void,
) => unknown;

const scalarArb = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.string({
    maxLength: 24,
    unit: fc.constantFrom(
      ..." abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'\"\\!#$%&()*+,-./:;<=>?@[]^_`{|}~",
    ),
  }),
);
const valueArb = fc.oneof(
  scalarArb,
  fc.array(scalarArb, { maxLength: 4 }),
  scalarArb.map((value) => ({ value })),
);
const documentsArb = fc.array(valueArb, { minLength: 2, maxLength: 6 }).map(
  (values) => values.map((value, index) => ({ index, value })),
);
const eolArb = fc.constantFrom("\n", "\r\n");

function renderDocuments(documents: ExpectedDocument[], eol: string): string {
  return documents
    .map((document) => `---${eol}${JSON.stringify(document)}${eol}`)
    .join("");
}

function capture(operation: () => unknown): Outcome {
  try {
    return { status: "returned", value: operation() };
  } catch (error) {
    return { status: "threw", error };
  }
}

function thrownValues(): unknown[] {
  return [
    undefined,
    null,
    false,
    0,
    "",
    "callback sentinel",
    Symbol("callback sentinel"),
    new Error("callback sentinel"),
    { sentinel: true },
    () => undefined,
  ];
}

const loadAllApis: LoadAllIterator[] = [
  (text, iterator) => jsYamlReference.loadAll(text, iterator),
  (text, iterator) => loadAll(text, iterator),
];

describe("js-yaml iterator callback behavior", () => {
  test.prop([documentsArb, eolArb], { numRuns: 100, seed: 20261014 })(
    "preserves thrown values and stops after the throwing document",
    (documents, eol) => {
      const text = renderDocuments(documents, eol);
      const sentinels = thrownValues();
      for (let stop = 0; stop < documents.length; stop += 1) {
        for (const sentinel of sentinels) {
          const traces = loadAllApis.map((load) => {
            const trace: unknown[] = [];
            const outcome = capture(() =>
              load(text, (document) => {
                trace.push(document);
                if (trace.length - 1 === stop) throw sentinel;
              }),
            );
            return { outcome, trace };
          });

          for (const { outcome, trace } of traces) {
            expect(outcome.status).toBe("threw");
            if (outcome.status === "threw") expect(outcome.error).toBe(sentinel);
            expect(trace).toEqual(documents.slice(0, stop + 1));
          }
          expect(traces[0]?.outcome.status).toBe(traces[1]?.outcome.status);
          expect(traces[0]?.trace).toEqual(traces[1]?.trace);
        }
      }
    },
  );

  test.prop([documentsArb, eolArb], { numRuns: 100, seed: 20261015 })(
    "recovers from nested callback throws and then propagates an outer throw",
    (documents, eol) => {
      const text = renderDocuments(documents, eol);
      const innerText = renderDocuments(documents.slice(0, 2), eol);

      for (let stop = 0; stop < documents.length; stop += 1) {
        const innerSentinel = Symbol("inner callback sentinel");
        const outerSentinel = { sentinel: "outer callback" };
        const runs = loadAllApis.map((load) => {
          const trace: unknown[] = [];
          let innerOutcome: Outcome | undefined;
          let nestedRecovery: Outcome = { status: "returned", value: undefined };
          const outerOutcome = capture(() =>
            load(text, (document) => {
              const outerIndex = (document as ExpectedDocument).index;
              trace.push(["outer", document]);
              if (outerIndex !== stop) return;

              innerOutcome = capture(() =>
                load(innerText, (innerDocument) => {
                  trace.push(["inner", innerDocument]);
                  if ((innerDocument as ExpectedDocument).index === 0) {
                    throw innerSentinel;
                  }
                }),
              );
              nestedRecovery = capture(() =>
                load(innerText, (nestedDocument) => {
                  trace.push(["nested-recovery", nestedDocument]);
                }),
              );
              throw outerSentinel;
            }),
          );
          const afterOuterFailure = capture(() =>
            load(innerText, (document) => {
              trace.push(["after-outer-failure", document]);
            }),
          );
          return {
            trace,
            innerOutcome,
            nestedRecovery,
            outerOutcome,
            afterOuterFailure,
          };
        });

        const expectedTrace = [
          ...documents
            .slice(0, stop + 1)
            .map((document) => ["outer", document]),
          ["inner", documents[0]],
          ...documents.slice(0, 2).map((document) => ["nested-recovery", document]),
          ...documents.slice(0, 2).map((document) => ["after-outer-failure", document]),
        ];

        for (const run of runs) {
          expect(run.innerOutcome?.status).toBe("threw");
          if (run.innerOutcome?.status === "threw") {
            expect(run.innerOutcome.error).toBe(innerSentinel);
          }
          expect(run.nestedRecovery).toEqual({
            status: "returned",
            value: undefined,
          });
          expect(run.outerOutcome.status).toBe("threw");
          if (run.outerOutcome.status === "threw") {
            expect(run.outerOutcome.error).toBe(outerSentinel);
          }
          expect(run.afterOuterFailure).toEqual({
            status: "returned",
            value: undefined,
          });
          expect(run.trace).toEqual(expectedTrace);
        }
        expect(runs[0]?.trace).toEqual(runs[1]?.trace);
        expect(runs[0]?.innerOutcome?.status).toBe(runs[1]?.innerOutcome?.status);
        expect(runs[0]?.outerOutcome.status).toBe(runs[1]?.outerOutcome.status);
      }
    },
  );
});
