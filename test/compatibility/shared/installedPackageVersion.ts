import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function installedPackageVersion(name: string): Promise<string> {
  let directory = path.dirname(fileURLToPath(import.meta.resolve(name)));
  while (true) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (manifest.name === name && typeof manifest.version === "string")
        return manifest.version;
    } catch (error) {
      if (
        error === null ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error("cannot locate installed package manifest for " + name);
    directory = parent;
  }
}
