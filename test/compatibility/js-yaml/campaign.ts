import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./evaluate.js";
import { encodeGraph } from "../shared/graph.js";
import {
  fullBooleanBasis,
  generatedDumps,
  generatedLoad,
  singleOptionWitnesses,
} from "./generators.js";
import { inventory, optionKeys } from "./options.js";
import { parseArguments } from "../shared/cli.js";
import { behaviorWitnesses } from "./witnesses.js";
import { execFileSync } from "node:child_process";
import type { CaseDescriptor, CaseResult, Outcome } from "./types.js";
import { installedPackageVersion } from "../shared/installedPackageVersion.js";
import {
  loadComposedCorpusSnapshot,
  type ComposedCorpusInput,
  type ComposedCorpusSnapshot,
} from "../shared/corpus.js";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function stableId(source: string, text: string, index: number): string {
  return `${source}-${index}-${hash(text).slice(0, 12)}`;
}
export function buildCorpusDescriptors(
  inputs: ComposedCorpusInput[],
): CaseDescriptor[] {
  const out: CaseDescriptor[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const source = input.source;
    const text = input.text;
    const added = input.corpusKind === "real-world";
    const categories = added
      ? ["corpus", "real-world", input.category!]
      : ["corpus"];
    out.push({
      id: stableId("corpus", text, i),
      operation: "load",
      text,
      options: { values: {} },
      source,
      categories,
    });
    out.push({
      id: `${stableId("corpus-all", text, i)}-all`,
      operation: "loadAll-array",
      text,
      options: { values: {} },
      source,
      categories: added
        ? ["corpus", "real-world", input.category!, "loadAll"]
        : ["corpus", "loadAll"],
    });
  }
  return out;
}

export function buildReferenceDumpDescriptor(
  descriptor: CaseDescriptor,
  value: unknown,
): CaseDescriptor {
  return {
    id: `dump-${descriptor.id}`,
    operation: "dump",
    graph: encodeGraph(value),
    options: { values: {} },
    source: `corpus-dump/${descriptor.source}`,
    categories: descriptor.categories.includes("real-world")
      ? [
          "corpus-dump",
          "real-world",
          ...descriptor.categories.filter((category) =>
            ["kubernetes", "docker-compose", "github-actions"].includes(category),
          ),
        ]
      : ["corpus-dump"],
  };
}
function percent(n: number, d: number): number | null {
  return d ? (100 * n) / d : null;
}
export function summarize(rows: CaseResult[]) {
  const count = (f: (r: CaseResult) => boolean) => rows.filter(f).length;
  const refOk = rows.filter((r) => r.reference.status === "success");
  const refErrors = rows.filter((r) => r.reference.status === "error");
  const bothErrors = rows.filter(
    (r) => r.reference.status === "error" && r.candidate.status === "error",
  );
  const refDumps = rows.filter(
    (r) =>
      r.descriptor.operation === "dump" && r.reference.status === "success",
  );
  const bothDumps = refDumps.filter((r) => r.candidate.status === "success");
  const sem = refDumps.filter((r) => r.semantic?.referenceAvailable === true);
  const callback = rows.filter(
    (r) =>
      r.descriptor.options.callback ||
      (r.descriptor.options.scalarStyleRules !== undefined &&
        r.descriptor.options.scalarStyleRules !== "empty") ||
      r.descriptor.options.legacy ||
      r.descriptor.operation.includes("iterator"),
  );
  const raw = {
    casesWithAnyGap: [count((r) => r.differences.length > 0), rows.length],
    acceptanceFailures: [
      count(
        (r) =>
          r.reference.status === "success" && r.candidate.status === "error",
      ),
      refOk.length,
    ],
    graphMismatches: [
      count((r) => r.differences.some((d) => d.category === "graph")),
      refOk.filter(
        (r) =>
          r.candidate.status === "success" && r.descriptor.operation !== "dump",
      ).length,
    ],
    referenceValidSemanticGap: [
      count(
        (r) =>
          r.reference.status === "success" &&
          (r.candidate.status !== "success" ||
            r.differences.some((d) =>
              ["graph", "dump-semantic"].includes(d.category),
            )),
      ),
      refOk.length,
    ],
    dumpByteDifferences: [
      count((r) => r.differences.some((d) => d.category === "dump-bytes")),
      refDumps.length,
    ],
    dumpByteCallFailures: [
      count(
        (r) =>
          r.reference.status === "success" &&
          r.descriptor.operation === "dump" &&
          r.candidate.status === "error",
      ),
      refDumps.length,
    ],
    dumpByteDifferenceBothSuccess: [
      count((r) => r.differences.some((d) => d.category === "dump-bytes")),
      bothDumps.length,
    ],
    dumpSemanticGaps: [
      count(
        (r) =>
          r.semantic?.referenceAvailable === true &&
          (r.semantic.candidateAvailable !== true ||
            r.semantic.equal === false),
      ),
      sem.length,
    ],
    rejectionDisagreements: [
      count(
        (r) =>
          r.reference.status === "error" && r.candidate.status === "success",
      ),
      refErrors.length,
    ],
    detailedErrorDifferences: [
      count((r) => r.differences.some((d) => d.category === "error-detail")),
      bothErrors.length,
    ],
    callbackDifferences: [
      callback.filter((r) =>
        r.differences.some((d) => d.category === "callback"),
      ).length,
      callback.length,
    ],
  };
  return Object.fromEntries(
    Object.entries(raw).map(([k, [n, d]]) => [
      k,
      { numerator: n, denominator: d, percent: percent(n, d) },
    ]),
  );
}
function persistOutcome(outcome: Outcome): unknown {
  if (outcome.status === "error") return outcome;
  const { value, ...rest } = outcome;
  return value === undefined
    ? { ...rest, valueGraph: encodeGraph(undefined) }
    : { ...rest, valueGraph: encodeGraph(value) };
}
function persistResult(row: CaseResult): unknown {
  return {
    ...row,
    reference: persistOutcome(row.reference),
    candidate: persistOutcome(row.candidate),
    semantic: row.semantic
      ? {
          ...row.semantic,
          ...(Object.hasOwn(row.semantic, "reference")
            ? { referenceGraph: encodeGraph(row.semantic.reference) }
            : {}),
          ...(Object.hasOwn(row.semantic, "candidate")
            ? { candidateGraph: encodeGraph(row.semantic.candidate) }
            : {}),
          reference: undefined,
          candidate: undefined,
        }
      : undefined,
  };
}
export async function main(): Promise<void> {
  const { seed, samples, replay, extended, strict, output } = parseArguments(
    process.argv.slice(2),
  );
  let descriptors: CaseDescriptor[];
  let corpusSnapshot: ComposedCorpusSnapshot | undefined;
  let corpusDumpEligibility = {
    referenceAccepted: 0,
    referenceRejected: 0,
    dumpDescriptors: 0,
    graphCodecUnsupported: 0,
  };
  if (replay) {
    const parsed: unknown = JSON.parse(
      await readFile(path.resolve(replay), "utf8"),
    );
    const possible =
      parsed !== null && typeof parsed === "object" && "descriptor" in parsed
        ? (parsed as { descriptor?: unknown }).descriptor
        : parsed;
    if (
      possible === null ||
      typeof possible !== "object" ||
      !("id" in possible) ||
      !("operation" in possible) ||
      !("options" in possible)
    )
      throw new Error("replay file does not contain a case descriptor");
    descriptors = [possible as CaseDescriptor];
  } else {
    corpusSnapshot = await loadComposedCorpusSnapshot();
    descriptors = buildCorpusDescriptors(corpusSnapshot.inputs);
    descriptors.push(...behaviorWitnesses());
    descriptors.push(
      ...generatedLoad(seed, samples),
      ...generatedDumps(seed, samples),
    );
    descriptors.push(
      ...singleOptionWitnesses().map((w, i) => ({
        id: `single-${i}`,
        operation: w.operation,
        text: w.operation === "load" ? "a: [1, 2]\n" : undefined,
        graph:
          w.operation === "dump"
            ? encodeGraph({ alpha: 1, beta: ["x", true] })
            : undefined,
        options: w.options,
        source: "single-option",
        categories: ["option-witness"],
      })),
    );
    const corpusLoadRows = descriptors
      .filter((d) => d.categories.includes("corpus") && d.operation === "load")
      .map(evaluate);
    for (const row of corpusLoadRows) {
      if (row.reference.status === "error") {
        corpusDumpEligibility.referenceRejected++;
        continue;
      }
      corpusDumpEligibility.referenceAccepted++;
      try {
        descriptors.push(
          buildReferenceDumpDescriptor(row.descriptor, row.reference.value),
        );
        corpusDumpEligibility.dumpDescriptors++;
      } catch (error) {
        if (
          !(error instanceof TypeError &&
            error.message.startsWith("Cannot encode graph:"))
        )
          throw error;
        corpusDumpEligibility.graphCodecUnsupported++;
      }
    }
    const multi = "---\na: 1\n---\nb: [2]\n";
    for (const operation of [
      "loadAll-array",
      "loadAll-null-third",
      "loadAll-iterator-third",
      "loadAll-iterator-throw",
      "loadAll-overriding",
    ] as const)
      descriptors.push({
        id: `call-${operation}`,
        operation,
        text: multi,
        options: { values: { filename: "outer.yaml" } },
        source: "call-signature",
        categories: ["loadAll", "call-signature"],
      });
    descriptors.push(
      {
        id: "custom-scalar-load",
        operation: "load",
        text: `!audit-upper hello\n`,
        options: { values: {}, schema: "custom-scalar" },
        source: "custom-schema",
        categories: ["custom-schema", "scalar-tag"],
      },
      {
        id: "custom-scalar-dump",
        operation: "dump",
        graph: encodeGraph("AUDIT:hello"),
        options: { values: {}, schema: "custom-scalar" },
        source: "custom-schema",
        categories: ["custom-schema", "scalar-tag"],
      },
    );
    for (const callback of [
      "identity",
      "mutate",
      "throw",
      "sort-asc",
      "sort-desc",
    ] as const)
      descriptors.push({
        id: `callback-${callback}`,
        operation: "dump",
        graph: encodeGraph({ z: 2, a: 1 }),
        options: { values: {}, callback },
        source: "callback-witness",
        categories: ["callback"],
      });
    for (const operation of ["load", "dump"] as const)
      descriptors.push({
        id: `legacy-${operation}`,
        operation,
        text: operation === "load" ? "a: 1\n" : undefined,
        graph: operation === "dump" ? encodeGraph({ a: 1 }) : undefined,
        options: { values: {}, legacy: true },
        source: "legacy-unknown-option",
        categories: ["legacy", "unknown-option"],
      });
    const special = [
      "undefined",
      "nan",
      "negative-zero",
      "positive-infinity",
      "negative-infinity",
      "invalid-date",
      "date",
      "typed-array",
      "map",
      "set",
      "shared-dag",
      "self-cycle",
      "mutual-cycle",
      "dangerous-keys",
      "function",
      "symbol",
    ];
    for (const valueRecipe of special)
      descriptors.push({
        id: `sentinel-${valueRecipe}`,
        operation: "dump",
        valueRecipe,
        options: { values: {} },
        source: "typed-sentinel",
        categories: ["typed", "sentinel"],
      });
    if (extended) {
      const shared = {
        label: "quoted value",
        nested: [1, "two words", { inner: true }],
      };
      const basisGraph = encodeGraph({
        "map key": "value with spaces",
        sequence: ["quoted", 2],
        left: shared,
        right: shared,
      });
      const configs = fullBooleanBasis();
      if (configs.length !== 4096)
        throw new Error(
          `boolean basis expected 4096 configurations, got ${configs.length}`,
        );
      for (let i = 0; i < configs.length; i++)
        descriptors.push({
          id: `bool-basis-${i}`,
          operation: "dump",
          graph: basisGraph,
          options: configs[i]!,
          source: "dump-boolean-cartesian",
          categories: ["boolean-basis"],
        });
    }
  }
  const unique = new Set(
    descriptors.map(
      (d) =>
        `${d.operation}:${d.text ?? d.graph ?? d.valueRecipe ?? ""}:${JSON.stringify(d.options)}`,
    ),
  ).size;
  const rows = descriptors.map(evaluate);
  const outDir = path.resolve(
    output ??
      path.join(
        repo,
        "results/compatibility/js-yaml",
        new Date().toISOString().replaceAll(":", "-"),
      ),
  );
  await mkdir(outDir, { recursive: true });
  const sourceGroups = Object.fromEntries(
    [...new Set(rows.map((r) => r.descriptor.source))].sort().map((source) => {
      const group = rows.filter((r) => r.descriptor.source === source);
      return [
        source,
        {
          scheduled: group.length,
          gaps: group.filter((r) => r.differences.length > 0).length,
          metrics: summarize(group),
        },
      ];
    }),
  );
  const opGroups = Object.fromEntries(
    [...new Set(rows.map((r) => r.descriptor.operation))].sort().map((op) => {
      const group = rows.filter((r) => r.descriptor.operation === op);
      return [
        op,
        {
          scheduled: group.length,
          gaps: group.filter((r) => r.differences.length > 0).length,
          metrics: summarize(group),
        },
      ];
    }),
  );
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  const dependencies = Object.fromEntries(
    await Promise.all(
      ["@fast-check/vitest", "fast-check", "js-yaml", "yaml", "zod", "zod-fast-check"].map(
        async (name) => [name, await installedPackageVersion(name)] as const,
      ),
    ),
  );
  const runtime = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    dependencies,
    revision,
    sourceBase: "f9e62ca9b3a4df753c76537843255b77d343eb5e",
  };
  const corpusProvenance = {
    suite: {
      repository: "https://github.com/yaml/yaml-test-suite",
      ref: "data-2022-01-17",
      license: "MIT",
      fileCount: 1954,
    },
    realWorld: {
      file: "test/corpus/currencycloud-reference.yaml",
      provenance:
        "Source URL is recorded in the vendored file header; snapshot inherited from origin/main",
    },
  };
  const composedProvenance = corpusSnapshot?.provenance;
  const manifest = {
    version: 1,
    runtime,
    corpusProvenance,
    corpusSnapshot: {
      scheduled: !replay,
      ...(composedProvenance ?? {}),
      scheduledAdditionalOperationCounts: replay
        ? {}
        : {
            load: descriptors.filter(
              (d) => d.categories.includes("real-world") && d.operation === "load",
            ).length,
            loadAllArray: descriptors.filter(
              (d) =>
                d.categories.includes("real-world") &&
                d.operation === "loadAll-array",
            ).length,
            dump: descriptors.filter(
              (d) => d.categories.includes("real-world") && d.operation === "dump",
            ).length,
          },
    },
    seed,
    requestedGeneratedPerKind: samples,
    scheduled: rows.length,
    uniqueDescriptors: unique,
    duplicates: rows.length - unique,
    options: inventory(),
    corpus: rows
      .filter((r) => r.descriptor.categories.includes("corpus"))
      .map((r) => ({
        path: r.descriptor.source,
        sha256: hash(r.descriptor.text ?? ""),
      })),
    corpusInputFiles: Array.from(
      new Map(
        (corpusSnapshot?.inputs ?? []).map((input) => [
          input.source,
          { path: input.source, sha256: input.sha256 },
        ] as const),
      ).values(),
    ),
    corpusCaps: { maxFileBytes: 2097152 },
    corpusDumpEligibility,
    extended: extended,
    replay: !!replay,
    shrink: {
      performed: false,
      reason:
        "This campaign does not shrink; every recorded descriptor is directly replayable.",
    },
  };
  const failures = rows.filter((r) => r.differences.length > 0);
  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    path.join(outDir, "coverage.json"),
    JSON.stringify(
      {
        scheduled: rows.length,
        uniqueDescriptors: unique,
        duplicates: rows.length - unique,
        byOperation: opGroups,
        bySource: sourceGroups,
        byOptionFamily: Object.fromEntries(
          [...new Set(rows.flatMap((r) => r.descriptor.categories))]
            .sort()
            .map((family) => {
              const group = rows.filter((r) =>
                r.descriptor.categories.includes(family),
              );
              return [
                family,
                {
                  scheduled: group.length,
                  gaps: group.filter((r) => r.differences.length > 0).length,
                  metrics: summarize(group),
                },
              ];
            }),
        ),
        booleanBasis: {
          expected: extended ? 4096 : 0,
          observed: rows.filter(
            (r) => r.descriptor.source === "dump-boolean-cartesian",
          ).length,
        },
        optionLedger: rows
          .filter((r) => r.descriptor.source === "single-option")
          .map((r) => ({
            id: r.descriptor.id,
            operation: r.descriptor.operation,
            keys: optionKeys(r.descriptor.options),
            explicitUndefinedKeys: r.descriptor.options.undefinedKeys ?? [],
            referenceValid: r.reference.status === "success",
            candidateValid: r.candidate.status === "success",
            gaps: r.differences.length,
          })),
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    path.join(outDir, "summary.json"),
    JSON.stringify(
      {
        metrics: summarize(rows),
        gapCases: failures.length,
        complete: true,
        limitations: [
          "Percentages describe only this bounded corpus and generated sample; they do not estimate all js-yaml behavior.",
          "Generated graph values are bounded. Custom scalar schemas are witnessed; custom sequence and mapping tag recipes are not generated.",
          "Legacy unknown options are separate ignored-option probes, not accepted js-yaml 5 capabilities.",
          "No shrinking is performed; replay each case directly with --replay.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    path.join(outDir, "cases.jsonl"),
    rows.map((r) => JSON.stringify(persistResult(r))).join("\n") + "\n",
  );
  await writeFile(
    path.join(outDir, "failures.jsonl"),
    failures
      .map((r) =>
        JSON.stringify({
          descriptor: r.descriptor,
          differences: r.differences,
          reference: persistOutcome(r.reference),
          candidate: persistOutcome(r.candidate),
        }),
      )
      .join("\n") + (failures.length ? "\n" : ""),
  );
  console.log(
    JSON.stringify({
      outDir,
      scheduled: rows.length,
      unique,
      gaps: failures.length,
      metrics: summarize(rows),
    }),
  );
  if (strict && failures.length) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
