import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { parseArguments } from "../shared/cli.js";
import { graphArb, textArb } from "../js-yaml/generators.js";
import { encodeGraph } from "../shared/graph.js";
import {
  campaignRepoRoot,
  corpusProvenance,
  loadComposedCorpusSnapshot,
  type ComposedCorpusInput,
  type ComposedCorpusSnapshot,
} from "../shared/corpus.js";
import { evaluate } from "./evaluate.js";
import { inventories, optionKeys, runtimeInventory } from "./options.js";
import {
  behaviorWitnesses,
  finiteBases,
  optionWitnesses,
} from "./witnesses.js";
import type { CaseDescriptor, CaseResult, Outcome } from "./types.js";
import { installedPackageVersion } from "../shared/installedPackageVersion.js";

const repo = campaignRepoRoot;
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
const pct = (n: number, d: number): number | null =>
  d === 0 ? null : (100 * n) / d;

export function isUnsupportedGraphCodecError(error: unknown): error is TypeError {
  return (
    error instanceof TypeError &&
    error.message.startsWith("Cannot encode graph:")
  );
}

export function summarize(rows: CaseResult[]) {
  const count = (test: (row: CaseResult) => boolean) =>
    rows.reduce((n, row) => n + Number(test(row)), 0);
  const parseRows = rows.filter((r) => r.descriptor.operation !== "stringify");
  const stringRows = rows.filter((r) => r.descriptor.operation === "stringify");
  const refString = stringRows.filter(
    (r) =>
      r.reference.status === "success" && typeof r.reference.text === "string",
  );
  const bothString = refString.filter(
    (r) =>
      r.candidate.status === "success" && typeof r.candidate.text === "string",
  );
  const semEligible = stringRows.filter(
    (r) => r.semantic?.referenceAvailable === true,
  );
  const metric = (n: number, d: number) => ({
    numerator: n,
    denominator: d,
    percent: pct(n, d),
  });
  return {
    casesWithAnyGap: metric(
      count((r) => r.differences.length > 0),
      rows.length,
    ),
    parseAcceptanceFailures: metric(
      count(
        (r) =>
          r.descriptor.operation !== "stringify" &&
          r.reference.status === "success" &&
          r.candidate.status === "error",
      ),
      count(
        (r) =>
          r.descriptor.operation !== "stringify" &&
          r.reference.status === "success",
      ),
    ),
    parseSemanticGaps: metric(
      count(
        (r) =>
          r.descriptor.operation === "parse" &&
          r.reference.status === "success" &&
          (r.candidate.status !== "success" ||
            r.differences.some((d) => d.category === "value")),
      ),
      count(
        (r) =>
          r.descriptor.operation === "parse" &&
          r.reference.status === "success",
      ),
    ),
    stringifyCallFailures: metric(
      count(
        (r) =>
          r.descriptor.operation === "stringify" &&
          r.reference.status === "success" &&
          (r.candidate.status !== "success" ||
            typeof r.candidate.text !== "string"),
      ),
      count(
        (r) =>
          r.descriptor.operation === "stringify" &&
          r.reference.status === "success" &&
          typeof r.reference.text === "string",
      ),
    ),
    stringifyByteDifferences: metric(
      count(
        (r) =>
          r.reference.status === "success" &&
          r.candidate.status === "success" &&
          typeof r.reference.text === "string" &&
          typeof r.candidate.text === "string" &&
          r.differences.some((d) => d.category === "stringify-bytes"),
      ),
      bothString.length,
    ),
    stringifyByteEquality: metric(
      count(
        (r) =>
          r.reference.status === "success" &&
          r.candidate.status === "success" &&
          typeof r.reference.text === "string" &&
          r.reference.text === r.candidate.text,
      ),
      bothString.length,
    ),
    stringifyReferenceUndefined: metric(
      count(
        (r) =>
          r.descriptor.operation === "stringify" &&
          r.reference.status === "success" &&
          r.reference.text === undefined,
      ),
      stringRows.length,
    ),
    stringifyUndefinedContractGaps: metric(
      count(
        (r) =>
          r.descriptor.operation === "stringify" &&
          r.reference.status === "success" &&
          r.reference.text === undefined &&
          (r.candidate.status !== "success" || r.candidate.text !== undefined),
      ),
      count(
        (r) =>
          r.descriptor.operation === "stringify" &&
          r.reference.status === "success" &&
          r.reference.text === undefined,
      ),
    ),
    stringifySemanticGaps: metric(
      count(
        (r) =>
          r.semantic?.referenceAvailable === true &&
          (r.semantic.candidateAvailable !== true ||
            r.semantic.equal === false),
      ),
      semEligible.length,
    ),
    callbackDifferences: metric(
      count((r) =>
        r.differences.some(
          (d) =>
            d.category === "callback" || d.category === "callback-or-warning",
        ),
      ),
      count(
        (r) =>
          r.descriptor.options.callback !== undefined ||
          /reviver|replacer/.test(r.descriptor.call ?? ""),
      ),
    ),
    documentSurfaceGaps: metric(
      count(
        (r) =>
          r.differences.some(
            (d) =>
              d.category === "document-surface" ||
              d.category === "document-ast",
          ) || r.documentSurface?.equal === false,
      ),
      count(
        (r) =>
          r.descriptor.operation === "parseDocument" ||
          r.descriptor.operation === "parseAllDocuments",
      ),
    ),
    documentAstGaps: metric(
      count((r) => r.differences.some((d) => d.category === "document-ast")),
      count(
        (r) =>
          r.descriptor.operation === "parseDocument" ||
          r.descriptor.operation === "parseAllDocuments",
      ),
    ),
    documentConversionGaps: metric(
      count((r) =>
        r.differences.some((d) => d.category === "document-semantic"),
      ),
      count(
        (r) =>
          r.descriptor.operation === "parseDocument" ||
          r.descriptor.operation === "parseAllDocuments",
      ),
    ),
    diagnosticDifferences: metric(
      count((r) => r.differences.some((d) => d.category === "diagnostic")),
      count(
        (r) =>
          r.descriptor.operation === "parseDocument" ||
          r.descriptor.operation === "parseAllDocuments",
      ),
    ),
    warningDifferences: metric(
      count((r) => r.differences.some((d) => d.category === "warning")),
      count(
        (r) =>
          r.descriptor.operation === "parseDocument" ||
          r.descriptor.operation === "parseAllDocuments",
      ),
    ),
    rejectionDisagreements: metric(
      count(
        (r) =>
          r.reference.status === "error" && r.candidate.status === "success",
      ),
      count((r) => r.reference.status === "error"),
    ),
    referenceDecodedStringifyRows: semEligible.length,
    candidateStringifyRows: bothString.length,
    parseRows: parseRows.length,
    stringifyRows: stringRows.length,
  };
}

function persistOutcome(outcome: Outcome): unknown {
  const { value, docs, trace, ...rest } = outcome;
  return {
    ...rest,
    ...(outcome.status === "success" &&
    Object.hasOwn(outcome, "text") &&
    outcome.text === undefined
      ? { textIsUndefined: true }
      : {}),
    ...(outcome.status === "success" && Object.hasOwn(outcome, "value")
      ? { valueGraph: encodeGraph(value) }
      : {}),
    ...(docs !== undefined ? { docsGraph: encodeGraph(docs) } : {}),
    traceGraph: encodeGraph(trace),
  };
}
function persistResult(row: CaseResult): unknown {
  const { documentSurface, ...rest } = row;
  return {
    ...rest,
    reference: persistOutcome(row.reference),
    candidate: persistOutcome(row.candidate),
    ...(documentSurface
      ? {
          documentSurface: {
            equal: documentSurface.equal,
            reason: documentSurface.reason,
            ...(Object.hasOwn(documentSurface, "reference")
              ? { referenceGraph: encodeGraph(documentSurface.reference) }
              : {}),
            ...(Object.hasOwn(documentSurface, "candidate")
              ? { candidateGraph: encodeGraph(documentSurface.candidate) }
              : {}),
          },
        }
      : {}),
  };
}
function descriptorKey(d: CaseDescriptor): string {
  return JSON.stringify({ ...d, id: undefined });
}
function stableId(prefix: string, text: string, index: number): string {
  return `${prefix}-${index}-${digest(text).slice(0, 12)}`;
}

export function parseReplayDescriptor(parsed: unknown): CaseDescriptor {
  const descriptor =
    isRecord(parsed) && "descriptor" in parsed ? parsed.descriptor : parsed;
  const validOptions = (value: unknown): value is CaseDescriptor["options"] =>
    isRecord(value) && isRecord(value.values);
  const isOperation = (value: unknown): value is CaseDescriptor["operation"] =>
    ["parse", "parseDocument", "parseAllDocuments", "stringify"].includes(
      String(value),
    );
  if (
    !isRecord(descriptor) ||
    typeof descriptor.id !== "string" ||
    !isOperation(descriptor.operation) ||
    !validOptions(descriptor.options) ||
    typeof descriptor.source !== "string" ||
    !Array.isArray(descriptor.categories) ||
    !descriptor.categories.every((category) => typeof category === "string") ||
    (descriptor.operation === "stringify"
      ? typeof descriptor.graph !== "string" &&
        typeof descriptor.valueRecipe !== "string"
      : typeof descriptor.text !== "string")
  )
    throw new Error("replay file does not contain a valid case descriptor");
  return descriptor as unknown as CaseDescriptor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readReplay(filename: string): Promise<CaseDescriptor> {
  return parseReplayDescriptor(
    JSON.parse(await readFile(path.resolve(filename), "utf8")) as unknown,
  );
}

function makeGenerated(seed: number, samples: number): CaseDescriptor[] {
  const texts = fc.sample(textArb, { seed, numRuns: samples });
  const values = fc.sample(graphArb, {
    seed: seed ^ 0x5f3759df,
    numRuns: samples,
  });
  const operations = ["parse", "parseDocument", "parseAllDocuments"] as const;
  return [
    ...texts.map((text, i) => ({
      id: stableId("generated-text", text, i),
      operation: operations[i % operations.length]!,
      text,
      options: { values: {} },
      source: "generated-yaml-text",
      categories: ["generated", "text"],
      seed,
    })),
    ...values.map((value, i) => ({
      id: `generated-graph-${i}`,
      operation: "stringify" as const,
      graph: encodeGraph(value),
      options: { values: {} },
      source: "generated-graph",
      categories: ["generated", "graph"],
      seed,
    })),
  ];
}

export function buildCorpusParseDescriptors(inputs: ComposedCorpusInput[]): CaseDescriptor[] {
  const descriptors: CaseDescriptor[] = [];
  const operations = ["parse", "parseDocument", "parseAllDocuments"] as const;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const categories = input.corpusKind === "real-world"
      ? ["corpus", "real-world", input.category!]
      : ["corpus"];
    for (const operation of operations) descriptors.push({
      id: `${stableId("corpus", input.text, i)}-${operation}`,
      operation,
      text: input.text,
      options: { values: {} },
      source: input.source,
      categories: [...categories, operation],
    });
  }
  return descriptors;
}

export function buildCorpusReferenceSerializationDescriptor(
  descriptor: CaseDescriptor,
  value: unknown,
): CaseDescriptor {
  return {
    id: `corpus-stringify-${descriptor.id}`,
    operation: "stringify",
    graph: encodeGraph(value),
    options: { values: {} },
    source: `corpus-reference-value/${descriptor.source}`,
    categories: descriptor.categories.includes("real-world")
      ? ["corpus-reference-value", "stringify", "real-world", ...descriptor.categories.filter((category) => ["kubernetes", "docker-compose", "github-actions"].includes(category))]
      : ["corpus-reference-value", "stringify"],
  };
}

async function buildDescriptors(
  seed: number,
  samples: number,
): Promise<{
  descriptors: CaseDescriptor[];
  corpusStats: Record<string, number>;
  corpusSnapshot: ComposedCorpusSnapshot;
}> {
  const corpusSnapshot = await loadComposedCorpusSnapshot();
  const inputs = corpusSnapshot.inputs;
  const descriptors = buildCorpusParseDescriptors(inputs);
  const parsed = descriptors.map((descriptor) => ({
    descriptor,
    result: evaluate(descriptor),
  }));
  let corpusReferenceValues = 0,
    corpusCodecUnsupported = 0;
  for (const { descriptor, result } of parsed) {
    if (
      descriptor.operation !== "parse" ||
      result.reference.status !== "success" ||
      !Object.hasOwn(result.reference, "value")
    )
      continue;
    try {
      descriptors.push(buildCorpusReferenceSerializationDescriptor(descriptor, result.reference.value));
      corpusReferenceValues++;
    } catch (error) {
      if (!isUnsupportedGraphCodecError(error)) throw error;
      corpusCodecUnsupported++;
    }
  }
  const generated = makeGenerated(seed, samples);
  descriptors.push(...generated, ...behaviorWitnesses());
  descriptors.push(
    ...optionWitnesses().map((d) => ({
      ...d,
      source: "single-option",
      categories: [...d.categories, "option-witness"],
    })),
  );
  const bases = finiteBases();
  const expected = { parse: 512, stringify: 1024, enum: 108 };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (bases[key].length !== expected[key])
      throw new Error(
        `${key} finite basis expected ${expected[key]} cases, got ${bases[key].length}`,
      );
    descriptors.push(
      ...bases[key].map((d) => ({
        ...d,
        source: `basis-${key}`,
        categories: [...d.categories, `basis-${key}`],
      })),
    );
  }
  return {
    descriptors,
    corpusSnapshot,
    corpusStats: {
      files: inputs.length,
      legacyInputFiles: inputs.filter((input) => input.corpusKind === "legacy").length,
      additionalInputFiles: inputs.filter((input) => input.corpusKind === "real-world").length,
      referenceValuesStringified: corpusReferenceValues,
      referenceValuesCodecUnsupported: corpusCodecUnsupported,
    },
  };
}

export async function main(): Promise<void> {
  const { seed, samples, strict, replay, output } = parseArguments(
    process.argv.slice(2),
  );
  const replaying = Boolean(replay);
  const built = replaying ? undefined : await buildDescriptors(seed, samples);
  const descriptors = replaying
    ? [await readReplay(replay!)]
    : built!.descriptors;
  const rows = descriptors.map(evaluate);
  const unique = new Set(descriptors.map(descriptorKey)).size;
  const duplicateCount = descriptors.length - unique;
  const outDir = path.resolve(
    output ?? path.join(repo, "results/compatibility/yaml"),
  );
  await mkdir(outDir, { recursive: true });
  const failures = rows.filter((row) => row.differences.length > 0);
  const summarizeGroups = (key: (r: CaseResult) => string) =>
    Object.fromEntries(
      [...new Set(rows.map(key))].sort().map((name) => {
        const group = rows.filter((row) => key(row) === name);
        return [name, { scheduled: group.length, metrics: summarize(group) }];
      }),
    );
  let revision: string;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    const output = (error as { output?: unknown[] }).output;
    if (
      typeof output?.[1] !== "string" ||
      !/^[0-9a-f]{40}\s*$/i.test(output[1])
    )
      throw error;
    revision = output[1].trim();
  }
  const yamlVersion = await installedPackageVersion("yaml");
  if (yamlVersion !== "2.9.0")
    throw new Error(`expected yaml@2.9.0, found yaml@${yamlVersion}`);
  const runtime = {
    ...runtimeInventory(),
    yamlVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    revision,
    sourceBase: "f9e62ca9b3a4df753c76537843255b77d343eb5e",
  };
  const composedProvenance = built?.corpusSnapshot.provenance;
  const additionalScheduled = rows.filter((row) => row.descriptor.categories.includes("real-world"));
  const manifest = {
    version: 1,
    runtime,
    seed,
    requestedGeneratedYamlTexts: replaying ? 0 : samples,
    generatedYamlTextOperationCounts: replaying
      ? {}
      : Object.fromEntries(
          ["parse", "parseDocument", "parseAllDocuments"].map((op, lane) => [
            op,
            Math.floor(samples / 3) + Number(lane < samples % 3),
          ]),
        ),
    requestedGeneratedGraphs: replaying ? 0 : samples,
    scheduled: rows.length,
    uniqueDescriptors: unique,
    duplicates: duplicateCount,
    optionInventory: inventories,
    finiteBases: replaying
      ? { parse: 0, stringify: 0, enum: 0 }
      : { parse: 512, stringify: 1024, enum: 108 },
    corpusProvenance,
    corpusSnapshot: {
      scheduled: !replaying,
      ...(composedProvenance ?? {}),
      scheduledAdditionalOperationCounts: replaying ? {} : Object.fromEntries(
        ["parse", "parseDocument", "parseAllDocuments", "stringify"].map((op) => [
          op,
          additionalScheduled.filter((row) => row.descriptor.operation === op).length,
        ]),
      ),
    },
    corpusCaps: { maxFileBytes: 2097152 },
    corpus: built
      ? built.corpusSnapshot.legacyInputs.map(({ source, sha256 }) => ({
          source,
          sha256,
        }))
      : [],
    corpusInputFiles: built
      ? built.corpusSnapshot.inputs.map(({ source, sha256 }) => ({ source, sha256 }))
      : [],
    corpusStats: built?.corpusStats,
    replay: replaying,
    strict,
    safetyLedger: [
      "Cyclic reviver traversal is excluded because both implementations recurse without a cycle guard.",
      "aliasDuplicateObjects:false is excluded for cyclic graphs because the reference recursion is unbounded.",
      `Reference-accepted corpus values skipped stringify graph transport because the codec lacks their brand/features: ${built?.corpusStats.referenceValuesCodecUnsupported ?? 0}.`,
    ],
    shrink: {
      performed: false,
      reason:
        "Every case descriptor is directly replayable; this campaign does not shrink.",
    },
  };
  const operationCounts = Object.fromEntries(
    ["parse", "parseDocument", "parseAllDocuments", "stringify"].map((op) => [
      op,
      rows.filter((row) => row.descriptor.operation === op).length,
    ]),
  );
  const optionLedger = rows
    .filter((row) => row.descriptor.categories.includes("option-witness"))
    .map((row) => ({
      id: row.descriptor.id,
      operation: row.descriptor.operation,
      keys: optionKeys(row.descriptor.options),
      explicitUndefinedKeys: row.descriptor.options.undefinedKeys ?? [],
      referenceStatus: row.reference.status,
      referenceTraceEvents: row.reference.trace.length,
      candidateTraceEvents: row.candidate.trace.length,
      candidateStatus: row.candidate.status,
      gapCount: row.differences.length,
    }));
  const coverage = {
    scheduled: rows.length,
    uniqueDescriptors: unique,
    duplicates: duplicateCount,
    operationCounts,
    byOperation: summarizeGroups((r) => r.descriptor.operation),
    bySource: summarizeGroups((r) => r.descriptor.source),
    byFamily: Object.fromEntries(
      [...new Set(rows.flatMap((r) => r.descriptor.categories))]
        .sort()
        .map((family) => {
          const group = rows.filter((r) =>
            r.descriptor.categories.includes(family),
          );
          return [
            family,
            { scheduled: group.length, metrics: summarize(group) },
          ];
        }),
    ),
    finiteBases: {
      expected: replaying
        ? { parse: 0, stringify: 0, enum: 0 }
        : { parse: 512, stringify: 1024, enum: 108 },
      observed: Object.fromEntries(
        ["parse", "stringify", "enum"].map((base) => [
          base,
          rows.filter((r) => r.descriptor.source === `basis-${base}`).length,
        ]),
      ),
    },
    optionLedger,
    apiSurface: {
      missingExports: inventories.missingExports,
      documentMethods: inventories.documentMethods,
      candidateDocumentMethods: inventories.candidateDocumentMethods,
      missingDocumentMethods: inventories.documentMethods.filter(
        (method) => !inventories.candidateDocumentMethods.includes(method),
      ),
    },
    inventories,
  };
  const summary = {
    scope: replaying ? "replay" : "campaign",
    metrics: summarize(rows),
    gapCases: failures.length,
    complete: true,
    limitations: [
      "Results describe the recorded corpus, finite option bases, and bounded generated cases; they do not estimate every YAML input or option combination.",
      "The AST and public API surface reports measure differences from yaml@2.9.0 and do not establish a normative YAML compatibility result.",
      "Custom tag, callback, and schema recipes are finite witnesses; arbitrary user code and schemas are not sampled.",
      "The onTagObj callback witness does not activate the reference callback; Document.toJSON(key,onAnchor) and cross-document AST identity are not covered.",
    ],
  };
  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    path.join(outDir, "coverage.json"),
    JSON.stringify(coverage, null, 2) + "\n",
  );
  await writeFile(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await writeFile(
    path.join(outDir, "cases.jsonl"),
    rows.map((row) => JSON.stringify(persistResult(row))).join("\n") + "\n",
  );
  await writeFile(
    path.join(outDir, "failures.jsonl"),
    failures
      .map((row) =>
        JSON.stringify({
          descriptor: row.descriptor,
          differences: row.differences,
          reference: persistOutcome(row.reference),
          candidate: persistOutcome(row.candidate),
        }),
      )
      .join("\n") + (failures.length ? "\n" : ""),
  );
  console.log(
    JSON.stringify({
      outDir,
      scheduled: rows.length,
      unique,
      duplicates: duplicateCount,
      gaps: failures.length,
      metrics: summarize(rows),
    }),
  );
  if (strict && failures.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
