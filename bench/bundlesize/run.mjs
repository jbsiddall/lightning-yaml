// Bundle-size benchmark: how many KB does each YAML library add to a browser
// bundle when an app imports ONLY parse + stringify and ships it minified?
//
//   node bench/bundlesize/run.mjs            # measure + rewrite the README block
//   node bench/bundlesize/run.mjs --no-readme  # measure + print only
//   node bench/bundlesize/run.mjs --verify     # also prove tree-shaking is real
//
// Design notes live in bench/bundlesize/README.md. This file is intentionally
// plain ESM (.mjs), not TypeScript: it stays out of `pnpm typecheck` (which
// globs **/*.ts) so the heavy bundler toolchain is never needed for the gate.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url)); // bench/bundlesize
const ROOT = join(HERE, "..", ".."); // repo root
const SRC_INDEX = join(ROOT, "src", "index.ts");
const README = join(ROOT, "README.md");
const WORK = join(ROOT, "results", "bundlesize"); // gitignored (results/)
const ENTRIES = join(WORK, "entries");
const OUT = join(WORK, "out");

const args = new Set(process.argv.slice(2));
const WRITE_README = !args.has("--no-readme");
const VERIFY = args.has("--verify");

// ── The three libraries, each importing only its parse + stringify ──────────
// A side-effecting global sink keeps exactly those two functions (and their
// transitive code) while everything else is tree-shaken away.
const LIBRARIES = [
  {
    name: "lightning-yaml",
    // Unresolvable as a bare specifier (private, no build) → bundle the source.
    imports: `import { parse, stringify } from ${JSON.stringify(SRC_INDEX)};`,
    sink: "[parse, stringify]",
    ns: JSON.stringify(SRC_INDEX),
  },
  {
    name: "yaml",
    imports: `import { parse, stringify } from "yaml";`,
    sink: "[parse, stringify]",
    ns: '"yaml"',
  },
  {
    name: "js-yaml",
    imports: `import { load, dump } from "js-yaml";`,
    sink: "[load, dump]",
    ns: '"js-yaml"',
  },
];

function entrySource(lib) {
  return `${lib.imports}\nglobalThis.__lyBundleSink = ${lib.sink};\n`;
}
function namespaceEntrySource(lib) {
  // Imports the WHOLE module surface → defeats tree-shaking (for --verify).
  return `import * as __ns from ${lib.ns};\nglobalThis.__lyBundleSink = __ns;\n`;
}

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}
function gzip(buf) {
  return gzipSync(buf, { level: 9 }).length;
}
function brotli(buf) {
  return brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

/** report.ts's README marker-replace, copied so this .mjs has no TS import. */
function inject(readme, marker, content) {
  const start = `<!-- BENCH:${marker}:START -->`;
  const end = `<!-- BENCH:${marker}:END -->`;
  const si = readme.indexOf(start);
  const ei = readme.indexOf(end);
  if (si === -1 || ei === -1) {
    throw new Error(`README is missing the ${start} … ${end} markers`);
  }
  return readme.slice(0, si + start.length) + "\n" + content + "\n" + readme.slice(ei);
}

/** Ensure the isolated bundler toolchain is installed (once). */
function ensureToolchain() {
  if (existsSync(join(HERE, "node_modules", "vite"))) return;
  console.log("Installing the bundle-size toolchain (bench/bundlesize) — first run only…");
  const r = spawnSync("pnpm", ["install", "--ignore-workspace"], {
    cwd: HERE,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    throw new Error(
      "Failed to install bench/bundlesize deps. Run `pnpm install --ignore-workspace` in bench/bundlesize.",
    );
  }
}

async function measureOne(bundler, entryFile, tag) {
  const outDir = join(OUT, tag);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const bin = bundler.available(); // truthy; CLI → path
  const file = await bundler.run({
    entryFile,
    outDir,
    rootDir: ROOT,
    bin: typeof bin === "string" ? bin : undefined,
  });
  const buf = readFileSync(file);
  return { min: buf.length, gz: gzip(buf), br: brotli(buf) };
}

async function main() {
  ensureToolchain();
  if (!existsSync(join(ROOT, "node_modules", "yaml"))) {
    throw new Error("Root deps missing — run `pnpm install` in the repo root first.");
  }
  mkdirSync(ENTRIES, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const { BUNDLERS, bundlerVersion } = await import("./bundlers.mjs");

  // Partition bundlers into available vs skipped (report the skips once), and
  // capture each active bundler's version so the committed numbers name the
  // build that produced them (bun/deno are system runtimes, not lockfile-pinned).
  const active = [];
  const skipped = [];
  const versions = {};
  for (const b of BUNDLERS) {
    const bin = b.available();
    if (bin) {
      active.push(b);
      versions[b.name] = bundlerVersion(b, typeof bin === "string" ? bin : undefined);
    } else {
      skipped.push(b.name);
    }
  }

  // Write one entry file per library (shared across all bundlers).
  for (const lib of LIBRARIES) {
    writeFileSync(join(ENTRIES, `${lib.name}.mjs`), entrySource(lib));
    if (VERIFY) writeFileSync(join(ENTRIES, `${lib.name}.ns.mjs`), namespaceEntrySource(lib));
  }

  // Run the matrix: library × active bundler.
  const results = []; // { lib, bundler, rust, min, gz, br } | { lib, bundler, error }
  for (const lib of LIBRARIES) {
    const entryFile = join(ENTRIES, `${lib.name}.mjs`);
    for (const b of active) {
      const tag = `${lib.name}__${b.name}`;
      process.stdout.write(`  bundling ${tag} … `);
      try {
        const m = await measureOne(b, entryFile, tag);
        results.push({ lib: lib.name, bundler: b.name, rust: b.rust, ...m });
        console.log(`${fmtKB(m.min)} min · ${fmtKB(m.gz)} gz · ${fmtKB(m.br)} br`);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err).split("\n")[0];
        results.push({ lib: lib.name, bundler: b.name, rust: b.rust, error: msg });
        console.log(`FAILED (${msg})`);
      }
    }
  }

  if (VERIFY) {
    // Verify with a bundler that actually produced output.
    const good = active.find((b) => results.some((r) => r.bundler === b.name && r.gz));
    await runVerify(good, results);
  }

  const md = renderMarkdown(results, active, skipped, versions);
  console.log("\n" + md + "\n");

  if (WRITE_README) {
    const readme = readFileSync(README, "utf8");
    writeFileSync(README, inject(readme, "BUNDLESIZE", md));
    console.log(`Updated ${README} (BENCH:BUNDLESIZE block).`);
  } else {
    console.log("(--no-readme: README not modified)");
  }
}

// Prove tree-shaking is real: full-namespace import must be ≥ the parse+stringify
// bundle for every library. Console-only; not written to the README.
async function runVerify(bundler, results) {
  if (!bundler) return;
  console.log(`\nVerifying tree-shaking with ${bundler.name} (parse+stringify vs import *):`);
  for (const lib of LIBRARIES) {
    const tree = results.find((r) => r.lib === lib.name && r.bundler === bundler.name && r.gz);
    if (!tree) continue;
    const nsEntry = join(ENTRIES, `${lib.name}.ns.mjs`);
    try {
      const full = await measureOne(bundler, nsEntry, `${lib.name}__${bundler.name}__ns`);
      const shrunk = full.gz > tree.gz;
      const pct = full.gz ? Math.round((1 - tree.gz / full.gz) * 100) : 0;
      console.log(
        `  ${lib.name.padEnd(15)} tree-shaken ${fmtKB(tree.gz)} gz vs full ${fmtKB(full.gz)} gz ` +
          `→ ${shrunk ? `${pct}% smaller ✓` : "NO REDUCTION ✗"}`,
      );
    } catch (err) {
      console.log(`  ${lib.name.padEnd(15)} (namespace build failed: ${String(err).split("\n")[0]})`);
    }
  }
}

function renderMarkdown(results, active, skipped, versions = {}) {
  const cell = (r) => (r.error ? `⚠️ ${r.error.slice(0, 24)}` : fmtKB(r.min));
  const lines = [];
  lines.push("_Generated by `pnpm bench:bundlesize`. Entry imports only `parse` + `stringify`;");
  lines.push("bundled for the browser with tree-shaking + minification (identifier mangling).");
  lines.push("Sizes are deterministic. Lower is better._");
  lines.push("");
  lines.push("| Library | Bundler | Minified | Gzip | Brotli |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const lib of LIBRARIES) {
    const rows = results.filter((r) => r.lib === lib.name);
    rows.forEach((r, i) => {
      const name = i === 0 ? `**${lib.name}**` : "";
      const b = r.rust ? `${r.bundler} _(rust)_` : r.bundler;
      if (r.error) {
        lines.push(`| ${name} | ${b} | ⚠️ ${r.error.slice(0, 40)} | | |`);
      } else {
        lines.push(`| ${name} | ${b} | ${fmtKB(r.min)} | ${fmtKB(r.gz)} | ${fmtKB(r.br)} |`);
      }
    });
  }
  lines.push("");
  const activeNote = active
    .map((b) => `${b.name} ${versions[b.name] ?? "?"}${b.rust ? " (rust)" : ""}`)
    .join(", ");
  lines.push(`**Bundlers:** ${activeNote}.`);
  if (skipped.length) {
    lines.push(
      `**Skipped** (runtime not on PATH): ${skipped.join(", ")} — install to include ` +
        `(see [bench/bundlesize](bench/bundlesize/README.md)).`,
    );
  }
  lines.push(
    "**Method:** `yaml`/`js-yaml` resolve their ESM builds (browser platform); " +
      "`lightning-yaml` is bundled from `src/index.ts`. Turbopack is omitted — it has no " +
      "standalone library-bundling CLI (Next.js-only).",
  );
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
