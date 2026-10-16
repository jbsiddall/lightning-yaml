import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRealWorldCorpus,
  realWorldCorpusProvenance,
  type RealWorldInput,
} from "./realWorldCorpus.js";

export interface CorpusInput {
  source: string;
  text: string;
  sha256: string;
}

export interface ComposedCorpusInput extends CorpusInput {
  corpusKind: "legacy" | "real-world";
  id?: string;
  category?: string;
}

export interface ComposedCorpusProvenance {
  legacyInputCount: number;
  legacyAggregateSha256: string;
  suiteInputCount: number;
  inheritedInputCount: number;
  additionalInputCount: number;
  additionalAggregateSha256: string;
  combinedInputCount: number;
  combinedAggregateSha256: string;
  additionalInputs: Array<{
    id: string;
    category: string;
    repository: string;
    commit: string;
    sourcePath: string;
    source: string;
    sha256: string;
    license: string;
    licensePath: string;
    licenseSourcePath: string;
    licenseUrl: string;
    bytes: number;
    licenseBytes: number;
    licenseSha256: string;
  }>;
  realWorld: typeof realWorldCorpusProvenance;
}

export interface ComposedCorpusSnapshot {
  legacyInputs: CorpusInput[];
  inputs: ComposedCorpusInput[];
  provenance: ComposedCorpusProvenance;
}

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

async function readPinnedCorpusSnapshot(): Promise<{
  inputs: CorpusInput[];
  aggregateSha256: string;
}> {
  const suiteRoot = path.join(repo, "bench/yaml-test-suite/data");
  const files = [path.join(repo, "test/corpus/currencycloud-reference.yaml")];
  async function walk(directory: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      throw new Error(
        `required pinned yaml-test-suite corpus missing at ${directory}: ${String(error)}`,
      );
    }
    for (const name of names.sort()) {
      const file = path.join(directory, name);
      const info = await stat(file);
      if (info.isDirectory()) await walk(file);
      else if (name === "in.yaml") files.push(file);
    }
  }
  await walk(suiteRoot);
  const inputs: CorpusInput[] = [];
  for (const file of files) {
    const info = await stat(file);
    if (info.size > 2 * 1024 * 1024)
      throw new Error(`corpus input exceeds 2 MiB cap: ${file} (${info.size})`);
    const text = await readFile(file, "utf8");
    inputs.push({
      source: path.relative(repo, file).split(path.sep).join("/"),
      text,
      sha256: digest(text),
    });
  }

  const snapshot = JSON.parse(
    await readFile(new URL("./fixtures/corpus-snapshot.json", import.meta.url), "utf8"),
  ) as {
    suiteRef: string;
    suiteInputFiles: number;
    totalInputFiles: number;
    aggregateSha256: string;
  };
  const fingerprint = digest(
    JSON.stringify(inputs.map(({ source, sha256 }) => [source, sha256])),
  );
  if (
    snapshot.suiteRef !== "data-2022-01-17" ||
    inputs.length !== snapshot.totalInputFiles ||
    inputs.length - 1 !== snapshot.suiteInputFiles ||
    fingerprint !== snapshot.aggregateSha256
  )
    throw new Error(
      "Pinned corpus is missing, modified or from a different snapshot; regenerate with FORCE=1 pnpm gen:suite",
    );
  return { inputs, aggregateSha256: fingerprint };
}

export async function loadPinnedCorpus(): Promise<CorpusInput[]> {
  return (await readPinnedCorpusSnapshot()).inputs;
}

export const corpusProvenance = {
  suite: {
    repository: "https://github.com/yaml/yaml-test-suite",
    ref: "data-2022-01-17",
    license: "MIT",
    suiteInputFiles: 1954,
  },
  realWorld: {
    file: "test/corpus/currencycloud-reference.yaml",
    provenance:
      "Source URL is recorded in the vendored file header; snapshot inherited from origin/main",
  },
} as const;

export const campaignRepoRoot = repo;

function toComposedInput(input: RealWorldInput): ComposedCorpusInput {
  return {
    source: input.source,
    text: input.text,
    sha256: input.sha256,
    corpusKind: "real-world",
    id: input.id,
    category: input.category,
  };
}

export async function loadComposedCorpusSnapshot(): Promise<ComposedCorpusSnapshot> {
  const { inputs: legacyInputs, aggregateSha256: legacyAggregateSha256 } =
    await readPinnedCorpusSnapshot();
  const realWorldInputs = await loadRealWorldCorpus();
  const additions = realWorldInputs.map(toComposedInput);
  const inputs: ComposedCorpusInput[] = [
    ...legacyInputs.map((input) => ({ ...input, corpusKind: "legacy" as const })),
    ...additions,
  ];
  const suiteInputs = legacyInputs.filter((input) =>
    input.source.startsWith("bench/yaml-test-suite/data/"),
  );
  const inheritedInputs = legacyInputs.filter(
    (input) => input.source === "test/corpus/currencycloud-reference.yaml",
  );
  const additionalAggregateSha256 = digest(
    JSON.stringify(additions.map(({ source, sha256 }) => [source, sha256])),
  );
  const combinedAggregateSha256 = digest(
    JSON.stringify(inputs.map(({ source, sha256 }) => [source, sha256])),
  );
  const provenance: ComposedCorpusProvenance = {
    legacyInputCount: legacyInputs.length,
    legacyAggregateSha256,
    suiteInputCount: suiteInputs.length,
    inheritedInputCount: inheritedInputs.length,
    additionalInputCount: additions.length,
    additionalAggregateSha256,
    combinedInputCount: inputs.length,
    combinedAggregateSha256,
    additionalInputs: realWorldInputs.map((input) => ({
      id: input.id,
      category: input.category,
      repository: input.repository,
      commit: input.commit,
      sourcePath: input.sourcePath,
      source: input.source,
      sha256: input.sha256,
      license: input.license,
      licensePath: input.licensePath,
      licenseSourcePath: input.licenseSourcePath,
      licenseUrl: input.licenseUrl,
      bytes: input.bytes,
      licenseBytes: input.licenseBytes,
      licenseSha256: input.licenseSha256,
    })),
    realWorld: realWorldCorpusProvenance,
  };
  return { legacyInputs, inputs, provenance };
}

export async function loadComposedCorpus(): Promise<ComposedCorpusInput[]> {
  return (await loadComposedCorpusSnapshot()).inputs;
}

export async function loadComposedCorpusProvenance(): Promise<ComposedCorpusProvenance> {
  return (await loadComposedCorpusSnapshot()).provenance;
}
