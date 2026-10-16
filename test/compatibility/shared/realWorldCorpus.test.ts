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

describe("pinned real-world corpus", () => {
  it("loads every explicitly listed fixture and verifies its source and license bytes", async () => {
    const inputs = await loadRealWorldCorpus();
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.category)).toEqual([
      "kubernetes", "docker-compose", "github-actions",
    ]);
    for (const input of inputs) {
      expect(Buffer.byteLength(input.text)).toBe(input.bytes);
      expect(Buffer.byteLength(input.licenseText)).toBe(input.licenseBytes);
    }
  });

  it("rejects changed source and license bytes", async () => {
    const value = await manifest();
    await expect(readRealWorldInputs(value, async (file) => {
      const bytes = await readFile(file);
      return file.endsWith("kubernetes.yaml") ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
    })).rejects.toThrow(/fixture bytes or SHA-256/);
    await expect(readRealWorldInputs(value, async (file) => {
      const bytes = await readFile(file);
      return file.endsWith("kubernetes-website-LICENSE.txt") ? bytes.subarray(1) : bytes;
    })).rejects.toThrow(/license bytes or SHA-256/);
  });

  it("retains a valid UTF-8 byte-order mark as part of the pinned fixture bytes", async () => {
    const value = await manifest();
    const entry = value.inputs[0];
    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(path.join(repo, entry.localPath))]);
    entry.bytes = bomBytes.length;
    entry.sha256 = createHash("sha256").update(bomBytes).digest("hex");
    value.aggregateSha256 = createHash("sha256")
      .update(JSON.stringify(value.inputs.map((input: any) => [input.localPath, input.sha256])))
      .digest("hex");
    const loaded = await readRealWorldInputs(value, async (file) =>
      file.endsWith("kubernetes.yaml") ? bomBytes : readFile(file),
    );
    expect(loaded[0]!.text.charCodeAt(0)).toBe(0xfeff);
    expect(Buffer.from(loaded[0]!.text, "utf8")).toEqual(bomBytes);
  });

  it("rejects missing entries and any required category", async () => {
    const original = await manifest();
    await expect(readRealWorldInputs({ ...original, inputs: original.inputs.slice(0, 2), inputCount: 2 }))
      .rejects.toThrow(/missing required category/);
    const withoutCategory = structuredClone(original);
    withoutCategory.inputs[2].category = "docker-compose";
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
      if (file.endsWith("kubernetes.yaml")) throw new Error("missing file");
      return readFile(file);
    })).rejects.toThrow(/missing file/);
  });
});
