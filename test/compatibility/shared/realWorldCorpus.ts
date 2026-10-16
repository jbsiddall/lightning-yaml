import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RealWorldManifestEntry {
  id: string;
  category: "kubernetes" | "docker-compose" | "github-actions";
  repository: string;
  commit: string;
  sourcePath: string;
  sourceUrl: string;
  localPath: string;
  bytes: number;
  sha256: string;
  license: string;
  licensePath: string;
  licenseSourcePath: string;
  licenseUrl: string;
  licenseBytes: number;
  licenseSha256: string;
}

export interface RealWorldInput extends RealWorldManifestEntry {
  source: string;
  text: string;
  licenseText: string;
}

interface RealWorldManifest {
  schemaVersion: number;
  aggregateConvention: string;
  aggregateSha256: string;
  inputCount: number;
  inputs: RealWorldManifestEntry[];
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = path.join(repo, "test/corpus/real-world/manifest.json");
const requiredCategories = ["kubernetes", "docker-compose", "github-actions"] as const;
const shaPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const digest = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeRelative(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function validateManifest(value: unknown): RealWorldManifest {
  if (!record(value) || value.schemaVersion !== 1 ||
      value.aggregateConvention !== "sha256(JSON.stringify([[source, sha256], ...]))" ||
      !Number.isSafeInteger(value.inputCount) || !Array.isArray(value.inputs) ||
      value.inputCount !== value.inputs.length || !shaPattern.test(String(value.aggregateSha256))) {
    throw new Error("real-world corpus manifest has an invalid schema or declared count");
  }
  const ids = new Set<string>();
  const localPaths = new Set<string>();
  const sourcePins = new Set<string>();
  const categories = new Set<string>();
  const inputs: RealWorldManifestEntry[] = [];
  for (const item of value.inputs) {
    if (!record(item) || typeof item.id !== "string" || !item.id ||
        !["kubernetes", "docker-compose", "github-actions"].includes(String(item.category)) ||
        typeof item.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository) ||
        typeof item.commit !== "string" || !commitPattern.test(item.commit) ||
        !safeRelative(item.sourcePath) || !safeRelative(item.localPath) ||
        !safeRelative(item.licensePath) || !safeRelative(item.licenseSourcePath) || typeof item.sourceUrl !== "string" ||
        typeof item.licenseUrl !== "string" || typeof item.license !== "string" || !item.license ||
        !Number.isSafeInteger(item.bytes) || (item.bytes as number) <= 0 || (item.bytes as number) > 2 * 1024 * 1024 ||
        !Number.isSafeInteger(item.licenseBytes) || (item.licenseBytes as number) <= 0 ||
        !shaPattern.test(String(item.sha256)) || !shaPattern.test(String(item.licenseSha256))) {
      throw new Error("real-world corpus manifest contains an invalid entry");
    }
    const pin = `${item.repository}@${item.commit}:${item.sourcePath}`;
    if (ids.has(item.id) || localPaths.has(item.localPath) || sourcePins.has(pin))
      throw new Error(`real-world corpus manifest contains a duplicate ID, path or source pin: ${item.id}`);
    if (item.sourceUrl !== `https://github.com/${item.repository}/blob/${item.commit}/${item.sourcePath}` ||
        item.licenseUrl !== `https://github.com/${item.repository}/blob/${item.commit}/${item.licenseSourcePath}`)
      throw new Error(`real-world corpus manifest has a non-pinned source or license URL: ${item.id}`);
    ids.add(item.id);
    localPaths.add(item.localPath);
    sourcePins.add(pin);
    categories.add(String(item.category));
    inputs.push(item as unknown as RealWorldManifestEntry);
  }
  for (const category of requiredCategories) {
    if (!categories.has(category)) throw new Error(`real-world corpus is missing required category: ${category}`);
  }
  const aggregate = digest(JSON.stringify(inputs.map(({ localPath, sha256 }) => [localPath, sha256])));
  if (aggregate !== value.aggregateSha256)
    throw new Error("real-world corpus manifest aggregate hash does not match its ordered entries");
  return value as unknown as RealWorldManifest;
}

export async function readRealWorldInputs(
  manifestValue: unknown,
  readBytes: (file: string) => Promise<Uint8Array> = (file) => readFile(file),
): Promise<RealWorldInput[]> {
  const manifest = validateManifest(manifestValue);
  const inputs: RealWorldInput[] = [];
  for (const entry of manifest.inputs) {
    const sourceFile = path.resolve(repo, entry.localPath);
    const licenseFile = path.resolve(repo, entry.licensePath);
    if (!sourceFile.startsWith(`${repo}${path.sep}`) || !licenseFile.startsWith(`${repo}${path.sep}`))
      throw new Error(`real-world corpus path escapes the repository: ${entry.id}`);
    const sourceBytes = Buffer.from(await readBytes(sourceFile));
    const licenseBytes = Buffer.from(await readBytes(licenseFile));
    if (sourceBytes.length !== entry.bytes || digest(sourceBytes) !== entry.sha256)
      throw new Error(`real-world fixture bytes or SHA-256 do not match the manifest: ${entry.id}`);
    if (licenseBytes.length !== entry.licenseBytes || digest(licenseBytes) !== entry.licenseSha256)
      throw new Error(`real-world license bytes or SHA-256 do not match the manifest: ${entry.id}`);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let text: string;
    let licenseText: string;
    try {
      text = decoder.decode(sourceBytes);
      licenseText = decoder.decode(licenseBytes);
    } catch {
      throw new Error(`real-world fixture or license is not valid UTF-8: ${entry.id}`);
    }
    if (!Buffer.from(text, "utf8").equals(sourceBytes) || !Buffer.from(licenseText, "utf8").equals(licenseBytes))
      throw new Error(`real-world fixture or license does not round-trip as UTF-8: ${entry.id}`);
    inputs.push({ ...entry, source: entry.localPath, text, licenseText });
  }
  return inputs;
}

export async function loadRealWorldCorpus(): Promise<RealWorldInput[]> {
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read real-world corpus manifest: ${String(error)}`);
  }
  return readRealWorldInputs(manifestValue);
}

export const realWorldCorpusProvenance = {
  manifest: "test/corpus/real-world/manifest.json",
  aggregateConvention: "sha256(JSON.stringify([[source, sha256], ...]))",
  repositoryPins: "Each entry records a repository, immutable commit, source path, and source URL.",
} as const;

export const realWorldCorpusRepoRoot = repo;
