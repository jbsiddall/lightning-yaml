// Provenance-marker freshness check (issue #30).
//
// Hardcoded benchmark numbers and competitor claims in the docs carry an
// invisible marker recording what they depend on — the versions of the
// libraries measured and the lightning-yaml revision — e.g.
//
//     <!-- js-yaml:5.2.1 yaml:2.9.0 ly:83b1dd0 -->
//
// This scans for those markers and prints each pin against the version
// currently installed / the current repo HEAD, so a dependency bump that
// silently dates a published number surfaces instead of rotting. It is a
// dependency-free, informational sweep — run via `pnpm check:claims`, NOT part
// of the correctness gate — and exits non-zero only when a version pin has
// fallen behind its installed package, so it can be wired into CI later.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative, extname } from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function installedVersion(pkg) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

function headSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const SCAN_EXT = new Set([".md", ".mdx", ".astro"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".astro"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(extname(entry))) yield full;
  }
}

// `<name>:<value>`. The lookbehind keeps `yaml:` from matching the tail of
// `js-yaml:`, and `[^\s>]+` stops the value at a space or the closing `-->`.
const PIN_RE = /(?<![\w-])(bench|js-yaml|yaml|ly):([^\s>]+)/g;

// `ly` tracks HEAD, which moves every commit — report it, but a difference is
// expected, not a failure. `bench` points at a benchmark-data sha with no local
// source of truth to diff. Only the library version pins can be "stale".
const current = { "js-yaml": installedVersion("js-yaml"), yaml: installedVersion("yaml"), ly: headSha() };

let markerCount = 0;
let stale = 0;

for (const file of walk(repoRoot)) {
  const rel = relative(repoRoot, file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      // Drop non-claims: `<ver>` format-doc placeholders, and `bench:` tokens
      // that are really the pnpm script names (`bench:self`/`bench:competition`)
      // rather than a benchmark-data sha — a real bench pin is a git sha.
      const pins = [...line.matchAll(PIN_RE)]
        .map((m) => ({ name: m[1], value: m[2] }))
        .filter((p) => !p.value.startsWith("<") && (p.name !== "bench" || /^[0-9a-f]{7,40}$/.test(p.value)));
      // A real marker pins at least two facts; a lone `yaml:` in prose is not one.
      if (pins.length < 2) return;
      markerCount++;
      for (const { name, value } of pins) {
        if (name === "bench") continue;
        const cur = current[name];
        if (!cur) continue;
        const matches = value === cur;
        const flag = matches ? "ok   " : name === "ly" ? "moved" : "STALE";
        if (!matches && name !== "ly") stale++;
        console.log(`${flag}  ${rel}:${i + 1}  ${name}:${value}  (current ${cur})`);
      }
    });
}

console.log(`\n${markerCount} marker line(s) scanned; ${stale} stale version pin(s).`);
if (stale > 0) {
  console.log("A pinned library version is behind the installed one — re-measure and refresh the numbers + marker.");
}
process.exit(stale > 0 ? 1 : 0);
