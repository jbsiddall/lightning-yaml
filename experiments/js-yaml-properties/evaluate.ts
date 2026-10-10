import * as ref from "js-yaml";
import * as cand from "../../src/js-yaml-compat.ts";
import { compareGraph, decodeGraph, encodeGraph } from "./graph.js";
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
function invoke(d: CaseDescriptor, side: "reference" | "candidate"): Outcome {
  const trace: unknown[] = [];
  const isRef = side === "reference";
  const input = d.valueRecipe
    ? specialValue(d.valueRecipe)
    : d.graph
      ? decodeGraph(d.graph)
      : undefined;
  const opts = materializeOptions(d.options, side, d.operation, trace);
  let outcome: Outcome;
  try {
    if (d.operation === "dump")
      outcome = {
        status: "success",
        text: (isRef ? ref.dump : cand.dump)(input, opts as never),
        trace,
      };
    else {
      const text = d.text ?? "";
      let value: unknown;
      if (d.operation === "load")
        value = (isRef ? ref.load : cand.load)(text, opts as never);
      else if (d.operation === "loadAll-array")
        value = (isRef ? ref.loadAll : cand.loadAll)(text, opts as never);
      else if (d.operation === "loadAll-null-third")
        value = isRef
          ? ref.loadAll(text, null, opts as never)
          : cand.loadAll(text, null, opts as never);
      else if (
        d.operation === "loadAll-iterator-third" ||
        d.operation === "loadAll-iterator-throw"
      ) {
        const cb = (doc: unknown) => {
          trace.push(["document", doc]);
          if (d.operation === "loadAll-iterator-throw")
            throw new Error("iterator callback sentinel");
        };
        value = isRef
          ? ref.loadAll(text, cb, opts as never)
          : cand.loadAll(text, cb, opts as never);
      } else {
        const second = { filename: "override.yaml", maxDepth: 4 };
        value = isRef
          ? (ref.loadAll as (...args: unknown[]) => unknown)(text, second, opts)
          : (cand.loadAll as (...args: unknown[]) => unknown)(
              text,
              second,
              opts,
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
export function evaluate(d: CaseDescriptor): CaseResult {
  const reference = invoke(d, "reference"),
    candidate = invoke(d, "candidate"),
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
  if (d.operation === "dump" && reference.status === "success") {
    if (candidate.status === "success" && reference.text !== candidate.text)
      differences.push({ category: "dump-bytes" });
    const loadOpts = d.options.schema
      ? { schema: schemaFor("reference", d.options.schema) }
      : undefined;
    let refValue: unknown;
    try {
      refValue = ref.load(reference.text!, loadOpts as never);
    } catch (error) {
      semantic = {
        referenceAvailable: false,
        reason: `reference semantic load unavailable: ${errorRecord(error).message}`,
      };
      return { descriptor: d, reference, candidate, differences, semantic };
    }
    semantic = { reference: refValue, referenceAvailable: true };
    if (candidate.status !== "success") {
      semantic.reason = "candidate dump call failed";
      differences.push({ category: "dump-semantic" });
    } else {
      let candValue: unknown;
      try {
        candValue = ref.load(candidate.text!, loadOpts as never);
      } catch (error) {
        semantic.reason = `candidate semantic load failed: ${errorRecord(error).message}`;
        differences.push({ category: "dump-semantic" });
      }
      if (semantic.reason === undefined) {
        const compared = compareGraph(refValue, candValue);
        semantic = {
          reference: refValue,
          candidate: candValue,
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
    d.operation !== "dump" &&
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
    descriptor: d,
    reference,
    candidate,
    differences,
    ...(semantic ? { semantic } : {}),
  };
}
