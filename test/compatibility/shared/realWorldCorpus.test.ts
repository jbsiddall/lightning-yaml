import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadRealWorldCorpus, readRealWorldInputs } from "./realWorldCorpus.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = path.join(repo, "test/corpus/real-world/manifest.json");

async function manifest(): Promise<any> {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}
function refreshAggregate(value: any): void {
  value.inputCount = value.inputs.length;
  value.aggregateSha256 = createHash("sha256")
    .update(JSON.stringify(value.inputs.map((input: any) => [input.localPath, input.sha256])))
    .digest("hex");
}

describe("pinned real-world corpus", () => {
  it("loads every declared fixture and verifies its source and license bytes", async () => {
    const declared = await manifest();
    const inputs = await loadRealWorldCorpus();
    expect(inputs.map(({ id, localPath, sha256 }) => [id, localPath, sha256]))
      .toEqual(declared.inputs.map(({ id, localPath, sha256 }: any) => [id, localPath, sha256]));
    expect(inputs).toHaveLength(declared.inputCount);
    expect(new Set(inputs.map((input) => input.category))).toEqual(
      new Set(["kubernetes", "docker-compose", "github-actions"]),
    );
    for (const input of inputs) {
      expect(Buffer.byteLength(input.text)).toBe(input.bytes);
      expect(Buffer.byteLength(input.licenseText)).toBe(input.licenseBytes);
    }
  });

  it("rejects changed source and license bytes", async () => {
    const value = await manifest();
    const sourcePath = value.inputs.at(-1).localPath;
    const licensePath = value.inputs.at(-1).licensePath;
    await expect(readRealWorldInputs(value, async (file) => {
      const bytes = await readFile(file);
      return file.endsWith(path.basename(sourcePath)) ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
    })).rejects.toThrow(/fixture bytes or SHA-256/);
    await expect(readRealWorldInputs(value, async (file) => {
      const bytes = await readFile(file);
      return file.endsWith(path.basename(licensePath)) ? bytes.subarray(1) : bytes;
    })).rejects.toThrow(/license bytes or SHA-256/);
  });

  it("retains a valid UTF-8 byte-order mark as part of the pinned fixture bytes", async () => {
    const value = await manifest();
    const entry = value.inputs[0];
    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(path.join(repo, entry.localPath))]);
    entry.bytes = bomBytes.length;
    entry.sha256 = createHash("sha256").update(bomBytes).digest("hex");
    refreshAggregate(value);
    const loaded = await readRealWorldInputs(value, async (file) =>
      file.endsWith(path.basename(entry.localPath)) ? bomBytes : readFile(file),
    );
    expect(loaded[0]!.text.charCodeAt(0)).toBe(0xfeff);
    expect(Buffer.from(loaded[0]!.text, "utf8")).toEqual(bomBytes);
  });

  it("rejects missing entries and any required category", async () => {
    const original = await manifest();
    const missingEntry = structuredClone(original);
    missingEntry.inputs = missingEntry.inputs.slice(0, -1);
    await expect(readRealWorldInputs(missingEntry)).rejects.toThrow(/declared count/);
    const withoutCategory = structuredClone(original);
    withoutCategory.inputs = withoutCategory.inputs.filter((input: any) => input.category !== "github-actions");
    refreshAggregate(withoutCategory);
    await expect(readRealWorldInputs(withoutCategory)).rejects.toThrow(/missing required category/);
  });

  it("rejects duplicate IDs, paths, and unsafe source paths", async () => {
    const original = await manifest();
    const duplicateId = structuredClone(original);
    duplicateId.inputs[1].id = duplicateId.inputs[0].id;
    await expect(readRealWorldInputs(duplicateId)).rejects.toThrow(/duplicate ID/);
    const duplicatePath = structuredClone(original);
    duplicatePath.inputs[1].localPath = duplicatePath.inputs[0].localPath;
    await expect(readRealWorldInputs(duplicatePath)).rejects.toThrow(/duplicate ID/);
    const unsafe = structuredClone(original);
    unsafe.inputs[0].sourcePath = "../escape.yaml";
    await expect(readRealWorldInputs(unsafe)).rejects.toThrow(/invalid entry/);
    const badAttribution = structuredClone(original);
    badAttribution.inputs[0].sourceUrl = "https://evil.invalid/blob/109572ac97242c9b3d68b4b26afdd22b5f88ed73/content/en/examples/controllers/nginx-deployment.yaml";
    await expect(readRealWorldInputs(badAttribution)).rejects.toThrow(/non-pinned source or license URL/);
    await expect(readRealWorldInputs(original, async (file) => {
      if (file.endsWith(path.basename(original.inputs[0].localPath))) throw new Error("missing file");
      return readFile(file);
    })).rejects.toThrow(/missing file/);
  });
});
