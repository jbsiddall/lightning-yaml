import * as reference from "yaml";
import * as candidate from "../../../src/yaml-compat.ts";
import { compareGraph, decodeGraph } from "../graph.js";
import { materializeOptions, summarize } from "./options.js";
import type {
  CaseDescriptor,
  CaseResult,
  ErrorRecord,
  Outcome,
} from "./types.js";

interface DocumentLike {
  contents?: unknown;
  errors?: Error[];
  warnings?: Error[];
  toJS(options?: Record<string, unknown>): unknown;
  toJSON(...args: unknown[]): unknown;
}
interface YamlApi {
  parse(...args: unknown[]): unknown;
  parseDocument(...args: unknown[]): DocumentLike;
  parseAllDocuments(
    ...args: unknown[]
  ): Iterable<DocumentLike> & Record<string, unknown>;
  stringify(...args: unknown[]): unknown;
}

function errorRecord(error: unknown): ErrorRecord {
  if (!(error instanceof Error))
    return { name: typeof error, message: String(error) };
  const yamlError = error as Error & {
    code?: string;
    pos?: number;
    linePos?: unknown;
  };
  return {
    name: yamlError.name,
    message: yamlError.message,
    ...(yamlError.code ? { code: yamlError.code } : {}),
    ...(yamlError.pos !== undefined ? { position: yamlError.pos } : {}),
    ...(yamlError.linePos !== undefined ? { linePos: yamlError.linePos } : {}),
  };
}

function normalizeTrace(trace: unknown[]): unknown[] {
  return trace.map((entry) => {
    if (Array.isArray(entry) && entry[0] === "lineCounter") {
      const counter = entry[1] as { lineStarts?: number[] };
      return ["lineCounter", { lineStarts: counter.lineStarts }];
    }
    return entry;
  });
}

function inputOf(
  descriptor: CaseDescriptor,
  side: "reference" | "candidate",
): unknown {
  if (descriptor.graph) return decodeGraph(descriptor.graph);
  switch (descriptor.valueRecipe) {
    case "undefined":
      return undefined;
    case "shared-dag": {
      const sharedValue = { value: 1 };
      return { first: sharedValue, second: sharedValue };
    }
    case "self-cycle": {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    }
    case "bigint":
      return 9007199254740993n;
    case "date":
      return new Date("2026-10-11T00:00:00Z");
    case "map":
      return new Map([
        ["a", 1],
        ["b", 2],
      ]);
    case "set":
      return new Set(["a", "b"]);
    case "yaml-document-input":
      return (side === "reference" ? reference : candidate).parseDocument(
        "a: 1\n",
      );
    case "yaml-node-input":
      return (side === "reference" ? reference : candidate).parseDocument(
        "a: 1\n",
      ).contents;
    case "commented-document-input":
      return (side === "reference" ? reference : candidate).parseDocument(
        "a: 1 # note\n",
      );
    case "tagged-document-input":
      return (side === "reference" ? reference : candidate).parseDocument(
        "!<tag:example.com,2026:word> hello\n",
      );
    case "custom-value-input":
      return { _custom: "hello" };
    case undefined:
      return undefined;
    default:
      throw new TypeError(
        `Unknown YAML value recipe ${descriptor.valueRecipe}`,
      );
  }
}

function astSummary(node: unknown, seen = new Map<object, number>()): unknown {
  if (node === null || typeof node !== "object") return node;
  const astNode = node as Record<string, unknown>;
  const earlierId = seen.get(node);
  if (earlierId !== undefined) return { ref: earlierId };
  const id = seen.size;
  seen.set(node, id);
  const constructor = astNode.constructor as { name?: string } | undefined;
  const kind = constructor?.name ?? "Object";
  if (kind === "Scalar") {
    return {
      id,
      kind,
      value: astNode.value,
      tag: astNode.tag,
      anchor: astNode.anchor,
      comment: astNode.comment,
      range: astNode.range,
      source: astNode.source,
    };
  }
  if (kind === "Alias")
    return {
      id,
      kind,
      source: astNode.source,
      tag: astNode.tag,
      anchor: astNode.anchor,
    };
  if (kind === "Pair") {
    return {
      id,
      kind,
      key: astSummary(astNode.key, seen),
      value: astSummary(astNode.value, seen),
      comment: astNode.comment,
    };
  }
  if (kind === "YAMLMap" || kind === "YAMLSeq") {
    const items = (astNode.items ?? []) as unknown[];
    return {
      id,
      kind,
      tag: astNode.tag,
      anchor: astNode.anchor,
      flow: astNode.flow,
      comment: astNode.comment,
      items: items.map((item) => astSummary(item, seen)),
      range: astNode.range,
      source: astNode.source,
    };
  }
  return { id, kind };
}

function documentRecord(
  document: DocumentLike,
  conversionOptions: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    errors: (document.errors ?? []).map(errorRecord),
    warnings: (document.warnings ?? []).map(errorRecord),
    hasContents: "contents" in document,
  };
  let firstConversion: unknown;
  let firstSucceeded = false;
  try {
    firstConversion = document.toJS(conversionOptions);
    firstSucceeded = true;
    result.toJS = firstConversion;
  } catch (error) {
    result.toJSError = errorRecord(error);
  }
  try {
    const secondConversion = document.toJS(conversionOptions);
    result.toJSRepeated = secondConversion;
    if (firstSucceeded)
      result.toJSReturnsFreshValue = firstConversion !== secondConversion;
  } catch (error) {
    result.toJSRepeatedError = errorRecord(error);
  }
  if (firstSucceeded)
    try {
      if (
        firstConversion !== null &&
        typeof firstConversion === "object" &&
        Object.isExtensible(firstConversion) &&
        (Array.isArray(firstConversion) ||
          [Object.prototype, null].includes(
            Object.getPrototypeOf(firstConversion),
          ))
      ) {
        (firstConversion as Record<string, unknown>).__yaml_property_probe__ =
          "mutated";
        result.toJSAfterMutation = document.toJS(conversionOptions);
      }
    } catch (error) {
      result.toJSAfterMutationError = errorRecord(error);
    }
  try {
    result.toJSON = document.toJSON();
  } catch (error) {
    result.toJSONError = errorRecord(error);
  }
  try {
    result.contents = astSummary(document.contents);
  } catch (error) {
    result.contentsError = errorRecord(error);
  }
  return result;
}

function invoke(
  descriptor: CaseDescriptor,
  side: "reference" | "candidate",
): Outcome {
  const yamlApi = (side === "reference"
    ? reference
    : candidate) as unknown as YamlApi;
  const trace: unknown[] = [];
  const warnings: unknown[] = [];
  const oldWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String));
  };
  let outcome: Outcome;
  try {
    const options = materializeOptions(
      descriptor.options,
      side,
      descriptor.operation,
      trace,
    );
    const conversionOptions = descriptor.conversionOptions
      ? materializeOptions(descriptor.conversionOptions, side, "toJS", trace)
      : {};
    const value =
      descriptor.operation === "stringify"
        ? inputOf(descriptor, side)
        : undefined;
    if (descriptor.operation === "stringify") {
      let text: unknown;
      switch (descriptor.call) {
        case "stringify-function-replacer":
          text = yamlApi.stringify(
            value,
            function (this: unknown, key: string, replacement: unknown) {
              trace.push([
                "replacer",
                key,
                summarize(this),
                summarize(replacement),
              ]);
              return key === "drop" ? undefined : replacement;
            },
            options,
          );
          break;
        case "stringify-array-replacer":
          text = yamlApi.stringify(value, ["a"], options);
          break;
        case "stringify-null-third":
        case "stringify-options-third":
          text = yamlApi.stringify(value, null, options);
          break;
        case "stringify-options-overriding":
          text = yamlApi.stringify(value, { schema: "failsafe" }, options);
          break;
        case "stringify-omitted":
          text = yamlApi.stringify(value);
          break;
        case "stringify-undefined-second":
          text = yamlApi.stringify(value, undefined);
          break;
        case "stringify-falsy-second":
          text = yamlApi.stringify(value, false);
          break;
        case "stringify-shorthand-number":
          text = yamlApi.stringify(value, 4);
          break;
        case "stringify-shorthand-string":
          text = yamlApi.stringify(value, "    ");
          break;
        default:
          text = yamlApi.stringify(value, options);
      }
      outcome = { status: "success", text, trace };
    } else {
      const source = descriptor.text ?? "";
      if (descriptor.operation === "parse") {
        let parsedValue: unknown;
        if (descriptor.call === "parse-reviver") {
          parsedValue = yamlApi.parse(
            source,
            function (this: unknown, key: string, revived: unknown) {
              trace.push(["reviver", key, summarize(this), summarize(revived)]);
              return key === "drop" || key === "1" ? undefined : revived;
            },
            options,
          );
        } else if (descriptor.call === "parse-reviver-root") {
          parsedValue = yamlApi.parse(
            source,
            function (this: unknown, key: string, revived: unknown) {
              trace.push(["reviver", key, summarize(this), summarize(revived)]);
              if (key === "1") return undefined;
              return key === "" ? { wrapped: revived } : revived;
            },
            options,
          );
        } else if (descriptor.call === "parse-options-reviver") {
          parsedValue = yamlApi.parse(source, {
            ...options,
            reviver: (key: string, revived: unknown) => {
              trace.push(["reviver", key, summarize(revived)]);
              return revived;
            },
          });
        } else if (descriptor.call === "parse-omitted")
          parsedValue = yamlApi.parse(source);
        else if (descriptor.call === "parse-undefined-options")
          parsedValue = yamlApi.parse(source, undefined);
        else if (descriptor.call === "parse-null-options")
          parsedValue = yamlApi.parse(source, null);
        else parsedValue = yamlApi.parse(source, options);
        outcome = { status: "success", value: parsedValue, trace };
      } else {
        const documents =
          descriptor.operation === "parseDocument"
            ? [yamlApi.parseDocument(source, options)]
            : yamlApi.parseAllDocuments(source, options);
        const stream =
          "empty" in documents
            ? {
                empty: documents.empty,
                comment: documents.comment,
                errors: (documents.errors as Error[] | undefined)?.map(
                  errorRecord,
                ),
                warnings: (documents.warnings as Error[] | undefined)?.map(
                  errorRecord,
                ),
              }
            : undefined;
        const documentRows = Array.from(documents, (document) =>
          documentRecord(document, conversionOptions),
        );
        outcome = {
          status: "success",
          docs: documentRows,
          value: stream ? { documents: documentRows, stream } : documentRows,
          ...(stream ? { stream } : {}),
          trace,
        };
      }
    }
  } catch (error) {
    outcome = { status: "error", error: errorRecord(error), trace };
  } finally {
    console.warn = oldWarn;
  }
  outcome.trace = normalizeTrace(outcome.trace);
  outcome.warnings = warnings;
  return outcome;
}

function samePlainValue(
  referenceValue: unknown,
  candidateValue: unknown,
): boolean {
  if (referenceValue instanceof Error || candidateValue instanceof Error) {
    return (
      JSON.stringify(errorRecord(referenceValue)) ===
      JSON.stringify(errorRecord(candidateValue))
    );
  }
  return compareGraph(referenceValue, candidateValue).equal;
}

function documentDifferences(
  referenceOutcome: Outcome,
  candidateOutcome: Outcome,
  differences: CaseResult["differences"],
): CaseResult["documentSurface"] {
  const referenceDocuments = referenceOutcome.docs ?? [];
  const candidateDocuments = candidateOutcome.docs ?? [];
  const compareDocumentField = (field: string, category: string) => {
    const referenceValues = referenceDocuments.map(
      (document) => (document as Record<string, unknown>)[field],
    );
    const candidateValues = candidateDocuments.map(
      (document) => (document as Record<string, unknown>)[field],
    );
    const same =
      referenceValues.length === candidateValues.length &&
      samePlainValue(referenceValues, candidateValues);
    if (!same) differences.push({ category });
    return same;
  };
  const diagnosticsMatch = compareDocumentField("errors", "diagnostic");
  const documentWarningsMatch = compareDocumentField("warnings", "warning");
  const conversionMatches =
    compareDocumentField("toJS", "document-semantic") &&
    compareDocumentField("toJSError", "document-semantic") &&
    compareDocumentField("toJSRepeatedError", "document-semantic") &&
    compareDocumentField("toJSRepeated", "document-semantic") &&
    compareDocumentField("toJSReturnsFreshValue", "document-semantic") &&
    compareDocumentField("toJSAfterMutation", "document-semantic");
  const afterMutationErrorMatches = compareDocumentField(
    "toJSAfterMutationError",
    "document-semantic",
  );
  const jsonMatches =
    compareDocumentField("toJSON", "document-semantic") &&
    compareDocumentField("toJSONError", "document-semantic");
  const astMatches = compareDocumentField("contents", "document-ast");
  const streamMatches = samePlainValue(
    referenceOutcome.stream,
    candidateOutcome.stream,
  );
  if (!streamMatches) differences.push({ category: "stream-metadata" });
  return {
    reference: referenceDocuments.map(
      (document) => (document as Record<string, unknown>).contents,
    ),
    candidate: candidateDocuments.map(
      (document) => (document as Record<string, unknown>).contents,
    ),
    equal:
      diagnosticsMatch &&
      documentWarningsMatch &&
      conversionMatches &&
      afterMutationErrorMatches &&
      jsonMatches &&
      astMatches,
    streamMetadataEqual: streamMatches,
  };
}

function semanticDecodeOptions(
  descriptor: CaseDescriptor,
): Record<string, unknown> {
  const materializedOptions = materializeOptions(
    descriptor.options,
    "reference",
    "parse",
    [],
  );
  const decodeKeys = [
    "schema",
    "version",
    "customTags",
    "resolveKnownTags",
    "intAsBigInt",
    "mapAsMap",
    "maxAliasCount",
  ];
  return Object.fromEntries(
    decodeKeys
      .filter((key) => key in materializedOptions)
      .map((key) => [key, materializedOptions[key]]),
  );
}

export function evaluate(descriptor: CaseDescriptor): CaseResult {
  const referenceOutcome = invoke(descriptor, "reference");
  const candidateOutcome = invoke(descriptor, "candidate");
  const differences: CaseResult["differences"] = [];
  if (referenceOutcome.status !== candidateOutcome.status)
    differences.push({ category: "acceptance" });
  if (
    referenceOutcome.status === "error" &&
    candidateOutcome.status === "error" &&
    JSON.stringify(referenceOutcome.error) !==
      JSON.stringify(candidateOutcome.error)
  ) {
    differences.push({ category: "error-detail" });
  }
  if (
    JSON.stringify(referenceOutcome.trace) !==
    JSON.stringify(candidateOutcome.trace)
  )
    differences.push({ category: "callback" });
  if (
    JSON.stringify(referenceOutcome.warnings) !==
    JSON.stringify(candidateOutcome.warnings)
  )
    differences.push({ category: "warning" });
  const result: CaseResult = {
    descriptor,
    reference: referenceOutcome,
    candidate: candidateOutcome,
    differences,
  };
  if (
    descriptor.operation === "stringify" &&
    referenceOutcome.status === "success"
  ) {
    if (
      candidateOutcome.status === "success" &&
      typeof referenceOutcome.text === "string" &&
      typeof candidateOutcome.text === "string" &&
      referenceOutcome.text !== candidateOutcome.text
    )
      differences.push({ category: "stringify-bytes" });
    if (typeof referenceOutcome.text !== "string") {
      result.semantic = {
        referenceAvailable: false,
        reason: "reference returned no YAML string",
      };
    } else {
      const decodeOptions = semanticDecodeOptions(descriptor);
      let referenceValue: unknown;
      try {
        referenceValue = reference.parse(referenceOutcome.text, decodeOptions);
      } catch (error) {
        result.semantic = {
          referenceAvailable: false,
          reason: errorRecord(error).message,
        };
        return result;
      }
      if (
        candidateOutcome.status !== "success" ||
        typeof candidateOutcome.text !== "string"
      ) {
        result.semantic = {
          referenceAvailable: true,
          candidateAvailable: false,
          reason: "candidate did not return a YAML string",
        };
        differences.push({ category: "stringify-semantic" });
      } else {
        let candidateValue: unknown;
        try {
          candidateValue = reference.parse(
            candidateOutcome.text,
            decodeOptions,
          );
        } catch (error) {
          result.semantic = {
            referenceAvailable: true,
            candidateAvailable: false,
            reason: errorRecord(error).message,
          };
          differences.push({ category: "stringify-semantic" });
          return result;
        }
        const comparison = compareGraph(referenceValue, candidateValue);
        result.semantic = {
          referenceAvailable: true,
          candidateAvailable: true,
          equal: comparison.equal,
          ...(comparison.path ? { path: comparison.path } : {}),
          ...(comparison.reason ? { reason: comparison.reason } : {}),
        };
        if (!comparison.equal)
          differences.push({
            category: "stringify-semantic",
            path: comparison.path,
            reason: comparison.reason,
          });
      }
    }
  } else if (
    descriptor.operation === "parse" &&
    referenceOutcome.status === "success" &&
    candidateOutcome.status === "success"
  ) {
    const comparison = compareGraph(
      referenceOutcome.value,
      candidateOutcome.value,
    );
    if (!comparison.equal)
      differences.push({
        category: "value",
        path: comparison.path,
        reason: comparison.reason,
      });
  } else if (
    descriptor.operation !== "stringify" &&
    descriptor.operation !== "parse" &&
    referenceOutcome.status === "success" &&
    candidateOutcome.status === "success"
  ) {
    result.documentSurface = documentDifferences(
      referenceOutcome,
      candidateOutcome,
      differences,
    );
  }
  return result;
}
