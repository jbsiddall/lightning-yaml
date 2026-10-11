import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as referenceYaml from "yaml";
import { encodeGraph } from "../graph.js";
import * as mainShim from "../../../src/yaml-compat.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const CANDIDATE_DEFAULT = path.join(
  repoRoot,
  ".scratch/yaml-cst-candidate/poc/yaml-compat/src/index.ts",
);
const REQUIRED_CST_CAPABILITIES = [
  "Parser (CST token generator)",
  "Composer (CST to Document pipeline)",
  "LineCounter",
  "CST token namespace",
  "CST.stringify",
  "Document node API",
  "node type guards and source-token attachment",
] as const;
const shimNamespace = mainShim as Record<string, unknown>;
export const MAIN_SHIM_MISSING_CAPABILITIES = REQUIRED_CST_CAPABILITIES.filter(
  (capability) => {
    if (capability === "CST token namespace") return !("CST" in shimNamespace);
    if (capability === "CST.stringify")
      return !(
        shimNamespace.CST &&
        typeof (shimNamespace.CST as Record<string, unknown>).stringify ===
          "function"
      );
    if (capability.startsWith("node type guards"))
      return ![
        "isNode",
        "isScalar",
        "isMap",
        "isSeq",
        "isPair",
        "isAlias",
      ].every((name) => name in shimNamespace);
    const name = capability.split(" ")[0]!;
    return !(name in shimNamespace);
  },
);

export interface CSTOutcome {
  source: string;
  sourceSha256: string;
  candidatePath: string;
  candidateFileSha256: string;
  status: "success" | "error";
  phase?: "load" | "parse" | "compose" | "nodes" | "reconstruct";
  error?: {
    name: string;
    message: string;
    code?: string;
    pos?: number;
    linePos?: unknown;
  };
  lineCounter?: {
    lineStarts: number[];
    positions: Array<{ offset: number; line: number; col: number }>;
  };
  tokens?: unknown[];
  tokenIdentity?: unknown[];
  tokenTypes?: string[];
  reconstructed?: string;
  reconstructionEqual?: boolean;
  documents?: unknown[];
  nodes?: unknown[];
  nodeIdentity?: unknown[];
  diagnostics?: unknown;
  values?: unknown[];
  mainShimMissingCapabilities: string[];
  reference?: Omit<CSTOutcome, "reference" | "mainShimMissingCapabilities">;
  differences?: Array<{ category: string; path?: string }>;
}

const node = await import("node:fs/promises");
const candidatePath = CANDIDATE_DEFAULT;
let cached: Promise<any> | undefined;
export const CANDIDATE_PIN = "6a25ef63d6d9d5114515660ecc25a06542af6647";
export const CANDIDATE_SOURCE_TREE_SHA256 =
  "4eb37c906d79e10c104beffd1529e9c523bac5296f6a3c41f0c6e5fea4035427";
function candidateBase(): string {
  let current = path.dirname(candidatePath);
  while (path.dirname(current) !== current) {
    if (path.basename(current) === "yaml-cst-candidate") return current;
    current = path.dirname(current);
  }
  throw new Error(
    `candidate path is outside yaml-cst-candidate: ${candidatePath}`,
  );
}
async function verifyCandidateProvenance(): Promise<void> {
  const base = candidateBase();
  const manifestPath = path.join(base, "provenance.json");
  const manifest = JSON.parse(await node.readFile(manifestPath, "utf8")) as {
    commit?: string;
    entry?: string;
    sourceTreeSha256?: string;
  };
  if (manifest.commit !== CANDIDATE_PIN)
    throw new Error(
      `candidate pin mismatch: expected ${CANDIDATE_PIN}, got ${manifest.commit ?? "missing"}`,
    );
  if (
    typeof manifest.entry !== "string" ||
    typeof manifest.sourceTreeSha256 !== "string"
  )
    throw new Error(
      "candidate provenance manifest is missing entry or sourceTreeSha256",
    );
  if (manifest.sourceTreeSha256 !== CANDIDATE_SOURCE_TREE_SHA256)
    throw new Error(
      `candidate manifest source tree hash mismatch: expected ${CANDIDATE_SOURCE_TREE_SHA256}, got ${manifest.sourceTreeSha256}`,
    );
  const sourceRoot = path.join(base, "poc/yaml-compat/src");
  async function collect(directory: string): Promise<string[]> {
    const names = await node.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of names) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await collect(absolute)));
      else if (entry.isFile() && entry.name.endsWith(".ts"))
        files.push(absolute);
    }
    return files;
  }
  const records: string[] = [];
  for (const file of (await collect(sourceRoot)).sort()) {
    const relative = path.relative(sourceRoot, file).split(path.sep).join("/");
    const content = await node.readFile(file, "utf8");
    records.push(`${relative}\0${sha256(content)}\n`);
  }
  const treeHash = sha256(records.join(""));
  if (treeHash !== CANDIDATE_SOURCE_TREE_SHA256)
    throw new Error(
      `candidate source tree hash mismatch: expected ${CANDIDATE_SOURCE_TREE_SHA256}, got ${treeHash}`,
    );
  if (manifest.entry !== "poc/yaml-compat/src/index.ts")
    throw new Error(`candidate entry mismatch: ${manifest.entry}`);
}
async function loadCandidate(): Promise<any> {
  cached ??= (async () => {
    await verifyCandidateProvenance();
    return import(pathToFileURL(candidatePath).href);
  })();
  return cached;
}
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function normalize(value: any, seen = new WeakSet<object>()): any {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "number" && !Number.isFinite(value))
      return String(value);
    return value;
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "_source") continue;
    const item = value[key];
    if (typeof item !== "function" && item !== undefined)
      result[key] = normalize(item, seen);
  }
  seen.delete(value);
  return result;
}
function describeError(error: any): CSTOutcome["error"] {
  return {
    name: String(error?.name ?? typeof error),
    message: String(error?.message ?? error),
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
    ...(error?.pos !== undefined ? { pos: normalize(error.pos) } : {}),
    ...(error?.offset !== undefined ? { pos: normalize(error.offset) } : {}),
    ...(error?.linePos ? { linePos: normalize(error.linePos) } : {}),
  };
}
function diagnostics(items: any[] = []): unknown[] {
  return items.map((error) => describeError(error));
}
function nodesSnapshot(doc: any, api: any): unknown {
  const visited = new WeakSet<object>();
  function visit(value: any): any {
    if (value == null || typeof value !== "object") return value;
    if (visited.has(value)) return "[Circular]";
    visited.add(value);
    const out: Record<string, unknown> = {
      kind: api.isScalar(value)
        ? "scalar"
        : api.isMap(value)
          ? "map"
          : api.isSeq(value)
            ? "seq"
            : api.isPair(value)
              ? "pair"
              : api.isAlias(value)
                ? "alias"
                : (value.constructor?.name ?? "object"),
    };
    for (const key of [
      "source",
      "type",
      "style",
      "flow",
      "tag",
      "anchor",
      "commentBefore",
      "comment",
      "spaceBefore",
      "range",
      "srcToken",
    ]) {
      if (key in value) out[key] = normalize(value[key]);
    }
    if (api.isScalar(value)) out.value = normalize(value.value);
    if (Array.isArray(value.items)) out.items = value.items.map(visit);
    if ("key" in value || "value" in value) {
      if ("key" in value) out.key = visit(value.key);
      if ("value" in value && api.isPair(value))
        out.pairValue = visit(value.value);
    }
    if (api.isDocument(value)) {
      out.range = normalize(value.range);
      out.contents = visit(value.contents);
      out.commentBefore = value.commentBefore;
      out.comment = value.comment;
    }
    visited.delete(value);
    return out;
  }
  return visit(doc);
}

export function identityTopology(root: unknown): unknown[] {
  const known = new WeakMap<object, { id: number; firstPath: string }>();
  const occurrences: Array<{ path: string; id: number; backref?: string }> = [];
  let nextId = 0;
  function visit(value: any, path: string): void {
    if (value === null || typeof value !== "object") return;
    const prior = known.get(value);
    if (prior) {
      occurrences.push({ path, id: prior.id, backref: prior.firstPath });
      return;
    }
    const record = { id: nextId++, firstPath: path };
    known.set(value, record);
    occurrences.push({ path, id: record.id });
    if (Array.isArray(value))
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else
      for (const key of Object.keys(value).sort()) {
        if (key !== "_source") visit(value[key], `${path}.${key}`);
      }
  }
  visit(root, "$root");
  return occurrences;
}

function nodeIdentityTopology(documents: any[], api: any): unknown[] {
  return documents.map((doc) => {
    const known = new WeakMap<object, { id: number; firstPath: string }>();
    const occurrences: Array<{ path: string; id: number; backref?: string }> =
      [];
    let nextId = 0;
    function visit(value: any, path: string): void {
      if (value === null || typeof value !== "object") return;
      const prior = known.get(value);
      if (prior) {
        occurrences.push({ path, id: prior.id, backref: prior.firstPath });
        return;
      }
      const record = { id: nextId++, firstPath: path };
      known.set(value, record);
      occurrences.push({ path, id: record.id });
      if (api.isMap(value) || api.isSeq(value))
        value.items.forEach((item: unknown, index: number) =>
          visit(item, `${path}.items[${index}]`),
        );
      else if (api.isPair(value)) {
        visit(value.key, `${path}.key`);
        visit(value.value, `${path}.value`);
      }
    }
    visit(doc.contents, "$root");
    return occurrences;
  });
}

export async function evaluateCST(source: string): Promise<CSTOutcome> {
  const base: CSTOutcome = {
    source,
    sourceSha256: sha256(source),
    candidatePath,
    candidateFileSha256: "",
    status: "error",
    phase: "load",
    mainShimMissingCapabilities: [...MAIN_SHIM_MISSING_CAPABILITIES],
  };
  try {
    const [api, candidateBytes] = await Promise.all([
      loadCandidate(),
      node.readFile(candidatePath),
    ]);
    base.candidateFileSha256 = sha256(candidateBytes.toString("utf8"));
    const candidate = await runPipeline(api, source, base);
    const reference = await runPipeline(referenceYaml, source, base);
    const differences: CSTOutcome["differences"] = [];
    if (candidate.status !== reference.status)
      differences.push({ category: "acceptance" });
    for (const category of [
      "tokens",
      "documents",
      "nodes",
      "diagnostics",
      "values",
      "lineCounter",
      "reconstructed",
    ] as const) {
      const left = candidate[category],
        right = reference[category];
      const diff = firstDifference(left, right, `$.${category}`);
      if (diff) differences.push({ category, path: diff });
    }
    for (const [category, left, right] of [
      ["token-identity", candidate.tokenIdentity, reference.tokenIdentity],
      ["node-identity", candidate.nodeIdentity, reference.nodeIdentity],
    ] as const) {
      const diff = firstDifference(left, right, `$.${category}`);
      if (diff) differences.push({ category, path: diff });
    }
    if (candidate.status === "error" || reference.status === "error") {
      if (candidate.phase !== reference.phase)
        differences.push({ category: "pipeline-phase" });
      const errorDifference = firstDifference(
        candidate.error,
        reference.error,
        "$.error",
      );
      if (errorDifference)
        differences.push({ category: "pipeline-error", path: errorDifference });
    }
    if (candidate.reconstructionEqual !== reference.reconstructionEqual)
      differences.push({ category: "reconstruction-equality" });
    return {
      ...candidate,
      mainShimMissingCapabilities: [...MAIN_SHIM_MISSING_CAPABILITIES],
      reference,
      differences,
    };
  } catch (error) {
    return { ...base, error: describeError(error) };
  }
}

async function runPipeline(
  api: any,
  source: string,
  base: CSTOutcome,
): Promise<
  Omit<CSTOutcome, "reference" | "differences" | "mainShimMissingCapabilities">
> {
  const output: Omit<
    CSTOutcome,
    "reference" | "differences" | "mainShimMissingCapabilities"
  > = { ...base };
  const lc = new api.LineCounter();
  const parser = new api.Parser((offset: number) => lc.addNewLine(offset));
  let tokens: any[];
  try {
    tokens = [...parser.parse(source)];
  } catch (error) {
    return {
      ...output,
      phase: "parse",
      error: describeError(error),
      lineCounter: lineCounterSnapshot(lc, source.length),
    };
  }
  base.phase = "compose";
  const composer = new api.Composer({ strict: false, keepSourceTokens: true });
  let documents: any[];
  try {
    documents = [...composer.compose(tokens, true, source.length)];
  } catch (error) {
    return {
      ...output,
      phase: "compose",
      error: describeError(error),
      tokens: tokens.map((t) => normalize(t)),
      tokenTypes: tokens.map((t) => t.type),
      lineCounter: lineCounterSnapshot(lc, source.length),
    };
  }
  base.phase = "nodes";
  let docs: unknown[],
    nodes: unknown[],
    warningSets: unknown[],
    errorSets: unknown[],
    values: unknown[];
  try {
    docs = documents.map((doc) => ({
      range: normalize(doc.range),
      directives: normalize(doc.directives),
      commentBefore: doc.commentBefore,
      comment: doc.comment,
    }));
    nodes = documents.map((doc) => nodesSnapshot(doc.contents, api));
    warningSets = documents.map((doc) => diagnostics(doc.warnings));
    errorSets = documents.map((doc) => diagnostics(doc.errors));
    values = documents.map((doc) => {
      try {
        return { status: "success", graph: encodeGraph(doc.toJS()) };
      } catch (error) {
        return { status: "error", error: describeError(error) };
      }
    });
  } catch (error) {
    return {
      ...output,
      phase: "nodes",
      error: describeError(error),
      tokens: tokens.map((t) => normalize(t)),
      tokenTypes: tokens.map((t) => t.type),
      lineCounter: lineCounterSnapshot(lc, source.length),
    };
  }
  base.phase = "reconstruct";
  let reconstructed = "";
  try {
    reconstructed = tokens.map((token) => api.CST.stringify(token)).join("");
  } catch (error) {
    return {
      ...output,
      phase: "reconstruct",
      error: describeError(error),
      tokens: tokens.map((t) => normalize(t)),
      tokenTypes: tokens.map((t) => t.type),
      documents: docs,
      nodes,
      diagnostics: { errors: errorSets, warnings: warningSets },
      values,
      lineCounter: lineCounterSnapshot(lc, source.length),
    };
  }
  return {
    ...output,
    status: "success",
    phase: undefined,
    tokens: tokens.map((t) => normalize(t)),
    tokenTypes: tokens.map((t) => t.type),
    tokenIdentity: identityTopology(tokens),
    nodeIdentity: nodeIdentityTopology(documents, api),
    reconstructed,
    reconstructionEqual: reconstructed === source,
    documents: docs,
    nodes,
    diagnostics: { errors: errorSets, warnings: warningSets },
    values,
    lineCounter: lineCounterSnapshot(lc, source.length),
  };
}

function lineCounterSnapshot(lc: any, length: number) {
  const offsets = new Set<number>([0, length]);
  for (const offset of lc.lineStarts) {
    offsets.add(offset);
    if (offset > 0) offsets.add(offset - 1);
    if (offset < length) offsets.add(offset + 1);
  }
  return {
    lineStarts: [...lc.lineStarts],
    positions: [...offsets]
      .sort((a, b) => a - b)
      .map((offset) => ({ offset, ...lc.linePos(offset) })),
  };
}

export function firstDifference(
  left: unknown,
  right: unknown,
  path = "$",
  seen = new WeakMap<object, object>(),
  reverseSeen = new WeakMap<object, object>(),
): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (
    typeof left !== typeof right ||
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return path;
  const prior = seen.get(left);
  if (prior) return prior === right ? undefined : path;
  const reversePrior = reverseSeen.get(right);
  if (reversePrior) return reversePrior === left ? undefined : path;
  seen.set(left, right);
  reverseSeen.set(right, left);
  const a = left as Record<string, any>,
    b = right as Record<string, any>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return `${path}.${key}`;
    const diff = firstDifference(
      a[key],
      b[key],
      `${path}.${key}`,
      seen,
      reverseSeen,
    );
    if (diff) return diff;
  }
  return undefined;
}

export async function candidateMetadata() {
  await verifyCandidateProvenance();
  const manifest = JSON.parse(
    await node.readFile(path.join(candidateBase(), "provenance.json"), "utf8"),
  ) as { sourceTreeSha256: string; commit: string; entry: string };
  return {
    origin:
      "poc/yaml-compat/src/index.ts; unmerged CST implementation PR 182 with latest stack PR 184",
    pin: manifest.commit,
    entry: manifest.entry,
    entryPath: candidatePath,
    sourceTreeSha256: manifest.sourceTreeSha256,
  };
}
