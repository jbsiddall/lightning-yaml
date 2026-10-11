import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArguments } from "../cli.js";
import { generatedLoad } from "../generators.js";
import {
  campaignRepoRoot,
  loadPinnedCorpus,
  corpusProvenance,
} from "./corpus.js";
import {
  CANDIDATE_DEFAULT,
  candidateMetadata,
  MAIN_SHIM_MISSING_CAPABILITIES,
  type CSTOutcome,
} from "./cst.js";

interface Input {
  source: string;
  text: string;
  sha256: string;
}
const DEFAULT_OUTPUT = path.join(
  campaignRepoRoot,
  "results/yaml-cst-properties/campaign.json",
);
const CASE_TIMEOUT_MS = Number(process.env.YAML_CST_CASE_TIMEOUT_MS ?? 2_000);
if (!Number.isFinite(CASE_TIMEOUT_MS) || CASE_TIMEOUT_MS <= 0)
  throw new Error("YAML_CST_CASE_TIMEOUT_MS must be a positive finite number");
let sharedWorker: Worker | undefined;
let nextWorkerRequest = 0;
let activeRequest:
  | {
      id: number;
      resolve: (outcome: CSTOutcome) => void;
      timer: NodeJS.Timeout;
      source: string;
    }
  | undefined;

function failedWorkerOutcome(
  source: string,
  name: string,
  message: string,
): CSTOutcome {
  return {
    source,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    candidatePath: CANDIDATE_DEFAULT,
    candidateFileSha256: "",
    status: "error",
    phase: "parse",
    error: { name, message },
    mainShimMissingCapabilities: [...MAIN_SHIM_MISSING_CAPABILITIES],
  };
}

function ensureWorker() {
  if (sharedWorker) return sharedWorker;
  const worker = new Worker(new URL("./cst-worker.ts", import.meta.url));
  sharedWorker = worker;
  worker.on(
    "message",
    (message: { id: number; outcome?: CSTOutcome; error?: string }) => {
      if (!activeRequest || message.id !== activeRequest.id) return;
      clearTimeout(activeRequest.timer);
      const { resolve, source } = activeRequest;
      activeRequest = undefined;
      resolve(
        message.outcome ??
          failedWorkerOutcome(
            source,
            "WorkerError",
            message.error ?? "worker returned an invalid response",
          ),
      );
    },
  );
  worker.on("error", (error) => {
    if (sharedWorker !== worker) return;
    const pending = activeRequest;
    if (pending) {
      clearTimeout(pending.timer);
      activeRequest = undefined;
      pending.resolve(
        failedWorkerOutcome(pending.source, "WorkerError", error.message),
      );
    }
    sharedWorker = undefined;
  });
  worker.on("exit", (code) => {
    if (sharedWorker !== worker) return;
    sharedWorker = undefined;
    const pending = activeRequest;
    if (pending) {
      clearTimeout(pending.timer);
      activeRequest = undefined;
      pending.resolve(
        failedWorkerOutcome(
          pending.source,
          "WorkerExit",
          `worker exited with code ${code}`,
        ),
      );
    }
  });
  return worker;
}

async function workerForSource(
  source: string,
  id: number,
): Promise<CSTOutcome> {
  return await new Promise((resolve) => {
    const worker = ensureWorker();
    const requestId = nextWorkerRequest++;
    const timer = setTimeout(() => {
      if (!activeRequest || activeRequest.id !== requestId) return;
      activeRequest = undefined;
      sharedWorker = undefined;
      void worker.terminate();
      resolve(
        failedWorkerOutcome(
          source,
          "WorkerTimeout",
          `worker exceeded ${CASE_TIMEOUT_MS}ms`,
        ),
      );
    }, CASE_TIMEOUT_MS);
    activeRequest = { id: requestId, resolve, timer, source };
    worker.postMessage({ id: requestId, source, caseId: id });
  });
}

function summarize(
  rows: Array<{ id: string; input: Input; outcome: CSTOutcome }>,
) {
  const categories = [
    "acceptance",
    "tokens",
    "token-identity",
    "documents",
    "nodes",
    "node-identity",
    "diagnostics",
    "values",
    "pipeline-phase",
    "pipeline-error",
    "lineCounter",
    "reconstructed",
    "reconstruction-equality",
  ];
  const observable = (row: { outcome: CSTOutcome }, category: string) => {
    const candidate = row.outcome;
    const reference = candidate.reference;
    if (!reference) return false;
    if (category === "acceptance")
      return candidate.status !== "error" || reference.status !== "error";
    if (category === "pipeline-phase" || category === "pipeline-error")
      return candidate.status === "error" || reference.status === "error";
    const field =
      (
        {
          "token-identity": "tokenIdentity",
          "node-identity": "nodeIdentity",
          "reconstruction-equality": "reconstructionEqual",
        } as Record<string, string>
      )[category] ?? category;
    return (
      candidate[field as keyof CSTOutcome] !== undefined &&
      reference[field as keyof typeof reference] !== undefined
    );
  };
  return {
    inputs: rows.length,
    successfulCandidatePipeline: rows.filter(
      (r) => r.outcome.status === "success",
    ).length,
    failurePhases: rows.reduce(
      (counts, r) => {
        const key =
          r.outcome.phase ??
          (r.outcome.status === "success" ? "success" : "unknown");
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    ),
    discrepancyCases: rows.filter(
      (r) => (r.outcome.differences?.length ?? 0) > 0,
    ).length,
    discrepancies: Object.fromEntries(
      categories.map((category) => {
        const comparable = rows.filter((r) => observable(r, category));
        return [
          category,
          {
            different: comparable.filter((r) =>
              r.outcome.differences?.some((d) => d.category === category),
            ).length,
            comparable: comparable.length,
            unavailable: rows.length - comparable.length,
          },
        ];
      }),
    ),
    pipelineFailures: rows.filter(
      (r) =>
        r.outcome.status !== "success" ||
        ["WorkerError", "WorkerExit"].includes(r.outcome.error?.name ?? ""),
    ).length,
    reconstructionMismatches: rows.filter(
      (r) => r.outcome.reconstructionEqual === false,
    ).length,
    timeouts: rows.filter((r) => r.outcome.error?.name === "WorkerTimeout")
      .length,
  };
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const provenance = await candidateMetadata(); // integrity failures are a preflight error, not a measured discrepancy
    let inputs: Array<Input & { id: string }>;
    if (options.replay) {
      const replay: any = JSON.parse(
        await readFile(path.resolve(options.replay), "utf8"),
      );
      const text =
        typeof replay?.input?.text === "string"
          ? replay.input.text
          : typeof replay?.source === "string"
            ? replay.source
            : undefined;
      if (text === undefined)
        throw new Error("replay file must contain input.text or source");
      const source = replay.input?.source ?? replay.case?.source ?? "replay";
      inputs = [
        {
          id: replay.id ?? "replay",
          source,
          text,
          sha256: createHash("sha256").update(text).digest("hex"),
        },
      ];
    } else {
      const generated = generatedLoad(options.seed, options.samples).map(
        (row) => ({
          source: row.source,
          text: row.text ?? "",
          sha256: createHash("sha256")
            .update(row.text ?? "")
            .digest("hex"),
          id: row.id,
        }),
      );
      inputs = generated;
      inputs.push(
        ...(await loadPinnedCorpus()).map((row) => ({
          ...row,
          id: `corpus:${row.source}`,
        })),
      );
    }
    const results: Array<{ id: string; input: Input; outcome: CSTOutcome }> =
      [];
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index]!;
      const outcome = await workerForSource(input.text, index);
      results.push({
        id: input.id,
        input: { source: input.source, text: input.text, sha256: input.sha256 },
        outcome,
      });
      if ((index + 1) % 100 === 0 || index + 1 === inputs.length)
        process.stderr.write(`CST cases ${index + 1}/${inputs.length}\n`);
    }
    const outputDirectory = options.output
      ? path.resolve(options.output)
      : path.dirname(DEFAULT_OUTPUT);
    const outputPath = path.join(outputDirectory, "campaign.json");
    await mkdir(path.dirname(outputPath), { recursive: true });
    const yamlPackage = JSON.parse(
      await readFile(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../node_modules/yaml/package.json",
        ),
        "utf8",
      ),
    ) as { version: string };
    if (yamlPackage.version !== "2.9.0")
      throw new Error(
        `CST reference dependency must be yaml@2.9.0; found yaml@${yamlPackage.version}`,
      );
    const harnessGitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: campaignRepoRoot,
      encoding: "utf8",
    }).trim();
    const report = {
      schema: "lightning-yaml-cst-properties/v1",
      generatedAt: new Date().toISOString(),
      mode: "bounded-persistent-worker",
      timeoutMs: CASE_TIMEOUT_MS,
      yamlReferenceVersion: yamlPackage.version,
      harnessGitSha,
      seed: options.seed,
      requestedSamples: options.samples,
      strict: options.strict,
      candidate: {
        ...provenance,
        mainShimCapabilities: {
          available: false,
          missing: MAIN_SHIM_MISSING_CAPABILITIES,
        },
      },
      corpus: corpusProvenance,
      summary: summarize(results),
      cases: results.map(({ id, input, outcome }) => ({
        id,
        source: input.source,
        inputSha256: input.sha256,
        status: outcome.status,
        phase: outcome.phase,
        error: outcome.error,
        differences: outcome.differences,
        reconstructionEqual: outcome.reconstructionEqual,
        tokenTypes: outcome.tokenTypes,
        candidateTokensSha256: outcome.tokens
          ? createHash("sha256")
              .update(JSON.stringify(outcome.tokens))
              .digest("hex")
          : undefined,
        referenceTokensSha256: outcome.reference?.tokens
          ? createHash("sha256")
              .update(JSON.stringify(outcome.reference.tokens))
              .digest("hex")
          : undefined,
        candidateTokenIdentitySha256: outcome.tokenIdentity
          ? createHash("sha256")
              .update(JSON.stringify(outcome.tokenIdentity))
              .digest("hex")
          : undefined,
        referenceTokenIdentitySha256: outcome.reference?.tokenIdentity
          ? createHash("sha256")
              .update(JSON.stringify(outcome.reference.tokenIdentity))
              .digest("hex")
          : undefined,
        candidateDocumentsSha256: outcome.documents
          ? createHash("sha256")
              .update(JSON.stringify(outcome.documents))
              .digest("hex")
          : undefined,
        referenceDocumentsSha256: outcome.reference?.documents
          ? createHash("sha256")
              .update(JSON.stringify(outcome.reference.documents))
              .digest("hex")
          : undefined,
        candidateNodesSha256: outcome.nodes
          ? createHash("sha256")
              .update(JSON.stringify(outcome.nodes))
              .digest("hex")
          : undefined,
        referenceNodesSha256: outcome.reference?.nodes
          ? createHash("sha256")
              .update(JSON.stringify(outcome.reference.nodes))
              .digest("hex")
          : undefined,
        candidateNodeIdentitySha256: outcome.nodeIdentity
          ? createHash("sha256")
              .update(JSON.stringify(outcome.nodeIdentity))
              .digest("hex")
          : undefined,
        referenceNodeIdentitySha256: outcome.reference?.nodeIdentity
          ? createHash("sha256")
              .update(JSON.stringify(outcome.reference.nodeIdentity))
              .digest("hex")
          : undefined,
        candidateDiagnosticsSha256: outcome.diagnostics
          ? createHash("sha256")
              .update(JSON.stringify(outcome.diagnostics))
              .digest("hex")
          : undefined,
        referenceDiagnosticsSha256: outcome.reference?.diagnostics
          ? createHash("sha256")
              .update(JSON.stringify(outcome.reference.diagnostics))
              .digest("hex")
          : undefined,
        ...(outcome.status !== "success" ||
        (outcome.differences?.length ?? 0) > 0
          ? { input: { source: input.source, text: input.text } }
          : {}),
      })),
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ output: outputPath, summary: report.summary, candidate: report.candidate }, null, 2)}\n`,
    );
    if (
      options.strict &&
      (report.summary.discrepancyCases > 0 ||
        report.summary.timeouts > 0 ||
        report.summary.pipelineFailures > 0 ||
        report.summary.inputs !== inputs.length)
    )
      process.exitCode = 1;
  } finally {
    if (sharedWorker) {
      const worker = sharedWorker;
      sharedWorker = undefined;
      await worker.terminate();
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
