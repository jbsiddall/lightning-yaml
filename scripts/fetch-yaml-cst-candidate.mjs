import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = "6a25ef63d6d9d5114515660ecc25a06542af6647";
const expectedTreeHash =
  "4eb37c906d79e10c104beffd1529e9c523bac5296f6a3c41f0c6e5fea4035427";
const source = "poc/yaml-compat/src";
const destination = path.join(repo, ".scratch/yaml-cst-candidate");
const provenanceFile = path.join(destination, "provenance.json");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
async function files(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      result.push(
        ...(await files(path.join(directory, entry.name), relative + "/")),
      );
    else if (entry.isFile()) result.push(relative);
    else throw new Error("Unexpected link in candidate source: " + relative);
  }
  return result.sort();
}
async function treeHash() {
  const directory = path.join(destination, source);
  const entries = await files(directory);
  const hashes = await Promise.all(
    entries.map(
      async (name) =>
        name + "\0" + sha256(await readFile(path.join(directory, name))) + "\n",
    ),
  );
  return sha256(hashes.join(""));
}
if (process.argv.slice(2).some((arg) => arg !== "--check"))
  throw new Error("Only --check is supported");
if (process.argv.includes("--check")) {
  const provenance = JSON.parse(await readFile(provenanceFile, "utf8"));
  if (
    provenance.commit !== commit ||
    provenance.sourceTreeSha256 !== expectedTreeHash ||
    provenance.sourceTreeSha256 !== (await treeHash())
  )
    throw new Error("Candidate source differs from its pinned provenance");
  console.log("Verified CST candidate " + commit);
} else {
  const exists = spawnSync("git", ["cat-file", "-e", commit + "^{commit}"], {
    cwd: repo,
  });
  if (exists.status !== 0)
    execFileSync("git", ["fetch", "--no-tags", "origin", commit], {
      cwd: repo,
      stdio: "inherit",
    });
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const archive = execFileSync("git", ["archive", commit, source], {
    cwd: repo,
    maxBuffer: 32 * 1024 * 1024,
  });
  const extracted = spawnSync("tar", ["-x", "-C", destination], {
    input: archive,
    encoding: "utf8",
  });
  if (extracted.status !== 0)
    throw new Error(extracted.stderr || "Candidate extraction failed");
  if ((await treeHash()) !== expectedTreeHash)
    throw new Error("Fetched candidate does not match the pinned source tree");
  await symlink(
    path.join(repo, "node_modules"),
    path.join(destination, "node_modules"),
    "dir",
  );
  const provenance = {
    commit,
    entry: source + "/index.ts",
    sourceTreeSha256: await treeHash(),
    pullRequest: "https://github.com/jbsiddall/lightning-yaml/pull/184",
  };
  await writeFile(provenanceFile, JSON.stringify(provenance, null, 2) + "\n");
  console.log(
    "Prepared CST candidate " +
      commit +
      " (" +
      provenance.sourceTreeSha256 +
      ")",
  );
}
