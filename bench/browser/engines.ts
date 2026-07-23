/**
 * Browser-engine registry for the driver (run.ts): resolving a real
 * executable for chromium (the pre-fetched cache may point at a file OR a
 * directory — see resolveChromiumExecutable) and launching either engine via
 * playwright-core, which is used purely as a launcher/CDP bridge here —
 * mitata (bundled into the page) remains the actual benchmarking engine.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright-core";

export type EngineName = "chromium" | "webkit";

export function isEngineName(s: string): s is EngineName {
  return s === "chromium" || s === "webkit";
}

const CHROMIUM_PATH_ENV = "LIGHTNING_YAML_CHROMIUM_PATH";
const DEFAULT_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const CHROMIUM_BINARY_NAMES = ["chrome", "chromium", "headless_shell"];

/** Breadth-first search for a file named like a chromium binary, bounded so a huge cache dir can't hang the driver. */
function findExecutableRecursive(dir: string, maxDepth = 4): string | undefined {
  let frontier = [dir];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const d of frontier) {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && CHROMIUM_BINARY_NAMES.includes(entry.name)) return join(d, entry.name);
      }
      for (const entry of entries) {
        if (entry.isDirectory()) nextFrontier.push(join(d, entry.name));
      }
    }
    frontier = nextFrontier;
  }
  return undefined;
}

/**
 * Resolves a real chromium executable from `configuredPath` (default
 * `/opt/pw-browsers/chromium`, overridable via `LIGHTNING_YAML_CHROMIUM_PATH`
 * for CI, where the cache layout may differ). Handles the path being a
 * symlink straight to the binary (the common case locally) OR a directory
 * (e.g. a bare `PLAYWRIGHT_BROWSERS_PATH` cache root) by searching inside it.
 */
export function resolveChromiumExecutable(
  configuredPath: string = process.env[CHROMIUM_PATH_ENV] ?? DEFAULT_CHROMIUM_PATH,
): string {
  if (!existsSync(configuredPath)) {
    throw new Error(
      `Configured chromium path does not exist: ${configuredPath}\n` +
        `Set ${CHROMIUM_PATH_ENV} to point at a chromium/chrome executable.`,
    );
  }
  const st = statSync(configuredPath); // follows symlinks — /opt/pw-browsers/chromium is one.
  if (st.isFile()) return configuredPath;
  if (st.isDirectory()) {
    const found = findExecutableRecursive(configuredPath);
    if (!found) {
      throw new Error(
        `${configuredPath} is a directory but no chromium/chrome/headless_shell executable was found inside it ` +
          `(searched ${CHROMIUM_BINARY_NAMES.length} names up to 4 levels deep).`,
      );
    }
    return found;
  }
  throw new Error(`Configured chromium path is neither a file nor a directory: ${configuredPath}`);
}

export interface LaunchedEngine {
  browser: Browser;
  family: EngineName;
}

const WEBKIT_INSTALL_HINT =
  "webkit is not installed locally (this environment only pre-fetches chromium). " +
  "Install it with `npx playwright install webkit`, or set PLAYWRIGHT_BROWSERS_PATH to a cache " +
  "that already has it. CI installs webkit via `playwright install --with-deps webkit` as part of " +
  "the browser-legs workflow — failing here locally is expected, not a bug in this harness.";

export async function launchEngine(name: EngineName): Promise<LaunchedEngine> {
  if (name === "chromium") {
    // Two resolution paths: this environment pre-fetches a chromium cache at a
    // fixed, non-standard location (see DEFAULT_CHROMIUM_PATH) that playwright-core
    // doesn't know about on its own, so resolveChromiumExecutable() finds it
    // explicitly. CI instead runs a normal `playwright install chromium`, which
    // playwright-core resolves itself via PLAYWRIGHT_BROWSERS_PATH (or its own
    // default cache dir) — same as the webkit path below already relies on. When
    // the fixed local path isn't there, fall through to that standard resolution
    // instead of failing, so one code path covers both environments.
    const configuredPath = process.env[CHROMIUM_PATH_ENV] ?? DEFAULT_CHROMIUM_PATH;
    const executablePath = existsSync(configuredPath) ? resolveChromiumExecutable(configuredPath) : undefined;
    const browser = await chromium.launch({ executablePath, headless: true });
    return { browser, family: "chromium" };
  }

  // webkit: no executablePath override — let playwright-core resolve its own
  // bundled revision under PLAYWRIGHT_BROWSERS_PATH, same as any normal
  // playwright-core install. There's no equivalent of the chromium
  // directory-search above because we don't know webkit's binary name
  // without playwright's own revision manifest, and it isn't present
  // locally to introspect.
  try {
    const browser = await webkit.launch({ headless: true });
    return { browser, family: "webkit" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${WEBKIT_INSTALL_HINT}\n\nOriginal error: ${detail}`);
  }
}
