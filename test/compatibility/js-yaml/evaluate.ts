import * as referenceYaml from "js-yaml";
import * as candidateYaml from "../../../src/js-yaml-compat.ts";
import { compareGraph, decodeGraph, encodeGraph } from "../shared/graph.js";
import { materializeOptions, schemaFor } from "./options.js";
import type {
  CaseDescriptor,
  CaseResult,
  ErrorRecord,
  Outcome,
} from "./types.js";

function specialValue(id: string): unknown {
  switch (id) {
    case "undefined":
      return undefined;
    case "nan":
      return NaN;
    case "negative-zero":
      return -0;
    case "positive-infinity":
      return Infinity;
    case "negative-infinity":
      return -Infinity;
    case "invalid-date":
      return new Date(NaN);
    case "date":
      return new Date("2026-10-11T00:00:00Z");
    case "typed-array":
      return new Uint16Array([0, 513, 65535]);
    case "map":
      return new Map<unknown, unknown>([
        ["a", 1],
        ["b", { nested: true }],
      ]);
    case "set":
      return new Set(["a", 2, false]);
    case "shared-dag": {
      const c = { value: 1 };
      return { first: c, second: c };
    }
    case "self-cycle": {
      const v: Record<string, unknown> = {};
      v.self = v;
      return v;
    }
    case "mutual-cycle": {
      const a: Record<string, unknown> = {},
        b: Record<string, unknown> = {};
      a.next = b;
      b.next = a;
      return a;
    }
    case "dangerous-keys":
      return JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"toString":"plain"}',
      );
    case "mixed-invalid":
      return {
        valid: 1,
        missing: undefined,
        function: function sentinel() {
          return 1;
        },
        symbol: Symbol.for("yaml-audit"),
      };
    case "function":
      return function sentinel() {
        return 1;
      };
    case "symbol":
      return Symbol.for("yaml-audit");
    default:
      throw new TypeError(`Unknown graph recipe ${id}`);
  }
}
function errorRecord(error: unknown): ErrorRecord {
  if (error instanceof Error) {
    const e = error as Error & { reason?: string; mark?: unknown };
    return {
      name: e.name,
      message: e.message,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.mark ? { mark: e.mark } : {}),
    };
  }
  return { name: typeof error, message: String(error) };
}
function normalizeTrace(trace: unknown[]): unknown[] {
  return trace.map((entry) => {
    if (Array.isArray(entry) && entry[0] === "document")
      return ["document", encodeGraph(entry[1])];
    return entry;
  });
}
function invoke(
  descriptor: CaseDescriptor,
  side: "reference" | "candidate",
): Outcome {
  const trace: unknown[] = [];
  const useReference = side === "reference";
  const input = descriptor.valueRecipe
    ? specialValue(descriptor.valueRecipe)
    : descriptor.graph
      ? decodeGraph(descriptor.graph)
      : undefined;
  const options = materializeOptions(
    descriptor.options,
    side,
    descriptor.operation,
    trace,
  );
  let outcome: Outcome;
  try {
    if (descriptor.operation === "dump")
      outcome = {
        status: "success",
        text: (useReference ? referenceYaml.dump : candidateYaml.dump)(
          input,
          options as never,
        ),
        trace,
      };
    else {
      const text = descriptor.text ?? "";
      let value: unknown;
      if (descriptor.operation === "load")
        value = (useReference ? referenceYaml.load : candidateYaml.load)(
          text,
          options as never,
        );
      else if (descriptor.operation === "loadAll-array")
        value = (useReference ? referenceYaml.loadAll : candidateYaml.loadAll)(
          text,
          options as never,
        );
      else if (descriptor.operation === "loadAll-null-third")
        value = useReference
          ? referenceYaml.loadAll(text, null, options as never)
          : candidateYaml.loadAll(text, null, options as never);
      else if (
        descriptor.operation === "loadAll-iterator-third" ||
        descriptor.operation === "loadAll-iterator-throw"
      ) {
        const iterator = (doc: unknown) => {
          trace.push(["document", doc]);
          if (descriptor.operation === "loadAll-iterator-throw")
            throw new Error("iterator callback sentinel");
        };
        value = useReference
          ? referenceYaml.loadAll(text, iterator, options as never)
          : candidateYaml.loadAll(text, iterator, options as never);
      } else {
        const second = { filename: "override.yaml", maxDepth: 4 };
        value = useReference
          ? (referenceYaml.loadAll as (...args: unknown[]) => unknown)(
              text,
              second,
              options,
            )
          : (candidateYaml.loadAll as (...args: unknown[]) => unknown)(
              text,
              second,
              options,
            );
      }
      outcome = { status: "success", value, trace };
    }
  } catch (error) {
    outcome = { status: "error", error: errorRecord(error), trace };
  }
  // Encoding callback effects is a harness operation and deliberately outside the implementation catch.
  outcome.trace = normalizeTrace(trace);
  return outcome;
}
export function evaluate(descriptor: CaseDescriptor): CaseResult {
  const reference = invoke(descriptor, "reference"),
    candidate = invoke(descriptor, "candidate"),
    differences: CaseResult["differences"] = [];
  if (reference.status !== candidate.status)
    differences.push({ category: "acceptance" });
  if (
    reference.status === "error" &&
    candidate.status === "error" &&
    JSON.stringify(reference.error) !== JSON.stringify(candidate.error)
  )
    differences.push({ category: "error-detail" });
  if (JSON.stringify(reference.trace) !== JSON.stringify(candidate.trace))
    differences.push({ category: "callback" });
  let semantic: CaseResult["semantic"];
  if (descriptor.operation === "dump" && reference.status === "success") {
    if (candidate.status === "success" && reference.text !== candidate.text)
      differences.push({ category: "dump-bytes" });
    const loadOpts = descriptor.options.schema
      ? { schema: schemaFor("reference", descriptor.options.schema) }
      : undefined;
    let referenceValue: unknown;
    try {
      referenceValue = referenceYaml.load(reference.text!, loadOpts as never);
    } catch (error) {
      semantic = {
        referenceAvailable: false,
        reason: `reference semantic load unavailable: ${errorRecord(error).message}`,
      };
      return {
        descriptor: descriptor,
        reference,
        candidate,
        differences,
        semantic,
      };
    }
    semantic = { reference: referenceValue, referenceAvailable: true };
    if (candidate.status !== "success") {
      semantic.reason = "candidate dump call failed";
      differences.push({ category: "dump-semantic" });
    } else {
      let candidateValue: unknown;
      try {
        candidateValue = referenceYaml.load(candidate.text!, loadOpts as never);
      } catch (error) {
        semantic.reason = `candidate semantic load failed: ${errorRecord(error).message}`;
        differences.push({ category: "dump-semantic" });
      }
      if (semantic.reason === undefined) {
        const compared = compareGraph(referenceValue, candidateValue);
        semantic = {
          reference: referenceValue,
          candidate: candidateValue,
          referenceAvailable: true,
          candidateAvailable: true,
          equal: compared.equal,
          ...(compared.path ? { path: compared.path } : {}),
          ...(compared.reason ? { reason: compared.reason } : {}),
        };
        if (!compared.equal)
          differences.push({
            category: "dump-semantic",
            path: compared.path,
            reason: compared.reason,
          });
      }
    }
  } else if (
    descriptor.operation !== "dump" &&
    reference.status === "success" &&
    candidate.status === "success"
  ) {
    const compared = compareGraph(reference.value, candidate.value);
    if (!compared.equal)
      differences.push({
        category: "graph",
        path: compared.path,
        reason: compared.reason,
      });
  }
  return {
    descriptor: descriptor,
    reference,
    candidate,
    differences,
    ...(semantic ? { semantic } : {}),
  };
}
