import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRealWorldCorpus, realWorldCorpusProvenance } from "../shared/realWorldCorpus.js";

export interface CorpusInput {
  source: string;
  text: string;
  sha256: string;
}

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

export async function loadPinnedCorpus(): Promise<CorpusInput[]> {
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
    await readFile(new URL("../shared/fixtures/corpus-snapshot.json", import.meta.url), "utf8"),
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
  return inputs;
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

export interface ComposedCorpusInput extends CorpusInput {
  corpusKind: "legacy" | "real-world";
  id?: string;
  category?: string;
}

export async function loadComposedCorpus(): Promise<ComposedCorpusInput[]> {
  const legacy = await loadPinnedCorpus();
  const additions = await loadRealWorldCorpus();
  return [
    ...legacy.map((input) => ({ ...input, corpusKind: "legacy" as const })),
    ...additions.map((input) => ({
      source: input.source,
      text: input.text,
      sha256: input.sha256,
      corpusKind: "real-world" as const,
      id: input.id,
      category: input.category,
    })),
  ];
}

export async function loadComposedCorpusProvenance() {
  const legacy = await loadPinnedCorpus();
  const suiteInputs = legacy.filter((input) => input.source.startsWith("bench/yaml-test-suite/data/"));
  const inheritedInputs = legacy.filter((input) => input.source === "test/corpus/currencycloud-reference.yaml");
  const additions = await loadRealWorldCorpus();
  const combined = [...legacy, ...additions];
  return {
    legacyInputCount: legacy.length,
    legacyAggregateSha256: digest(JSON.stringify(legacy.map(({ source, sha256 }) => [source, sha256]))),
    suiteInputCount: suiteInputs.length,
    inheritedInputCount: inheritedInputs.length,
    additionalInputCount: additions.length,
    additionalAggregateSha256: digest(JSON.stringify(additions.map(({ source, sha256 }) => [source, sha256]))),
    combinedInputCount: combined.length,
    combinedAggregateSha256: digest(JSON.stringify(combined.map(({ source, sha256 }) => [source, sha256]))),
    additionalInputs: additions.map(({ id, category, repository, commit, sourcePath, source, sha256, license, licensePath, licenseSourcePath, licenseUrl, bytes, licenseBytes, licenseSha256 }) => ({
      id, category, repository, commit, sourcePath, source, sha256, license, licensePath, licenseSourcePath, licenseUrl, bytes, licenseBytes, licenseSha256,
    })),
    realWorld: realWorldCorpusProvenance,
  };
}
