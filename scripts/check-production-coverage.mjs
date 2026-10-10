import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const summaryPath = resolve(
  root,
  "results/js-yaml-properties/coverage/coverage-summary.json",
);
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));

function productionFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

const expected = productionFiles(resolve(root, "src")).sort();
const actual = Object.keys(summary)
  .filter((key) => key !== "total")
  .map((path) => resolve(path))
  .sort();
const missing = expected.filter((path) => !actual.includes(path));
const extra = actual.filter((path) => !expected.includes(path));
if (missing.length || extra.length) {
  throw new Error(
    `Coverage file inventory differs: ${JSON.stringify({ missing, extra })}`,
  );
}
for (const metric of ["statements", "branches", "functions", "lines"]) {
  const { covered, total, pct } = summary.total[metric];
  if (
    !Number.isFinite(pct) ||
    !Number.isInteger(covered) ||
    !Number.isInteger(total) ||
    covered > total
  ) {
    throw new Error(`Invalid coverage counts for ${metric}`);
  }
  console.log(`${metric}: ${covered}/${total} (${pct}%)`);
}
console.log(
  `Production inventory: ${expected.length} files (${expected.map((path) => relative(root, path)).join(", ")})`,
);
