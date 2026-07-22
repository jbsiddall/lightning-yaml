/**
 * Tiny static file server for the browser benchmark harness. Serves
 * harness.html, the esbuild-bundled entry script, and the raw fixture files
 * (bench/fixtures/data/) — nothing else, no build step happens on request
 * (bench/browser/build.ts already ran by the time this starts).
 *
 * Every response carries COOP + COEP (+ CORP, belt-and-suspenders for
 * same-origin fetches under COEP `require-corp`) so the page is
 * `crossOriginIsolated`, which unclamps `performance.now()` in Chromium —
 * see bench/browser/entry.ts's timer-resolution probe and design contract
 * item 3 in the task this harness was built for.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { dataDir } from "../fixtures/datasets.ts";
import { BUNDLE_PATH } from "./build.ts";

const HARNESS_HTML = join(import.meta.dirname, "harness.html");

const CROSS_ORIGIN_ISOLATION_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
};

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function serveFile(res: ServerResponse, path: string): Promise<void> {
  try {
    const body = await readFile(path);
    res.writeHead(200, { ...CROSS_ORIGIN_ISOLATION_HEADERS, "Content-Type": contentTypeFor(path) });
    res.end(body);
  } catch {
    res.writeHead(404, CROSS_ORIGIN_ISOLATION_HEADERS);
    res.end("not found");
  }
}

/** `/fixtures/<basename>` -> bench/fixtures/data/<basename>, rejecting any attempt to escape the directory. */
async function serveFixture(res: ServerResponse, requestPath: string): Promise<void> {
  const basename = decodeURIComponent(requestPath.slice("/fixtures/".length));
  const resolved = normalize(join(dataDir, basename));
  if (!resolved.startsWith(dataDir + sep) || basename.includes("..")) {
    res.writeHead(400, CROSS_ORIGIN_ISOLATION_HEADERS);
    res.end("bad fixture path");
    return;
  }
  await serveFile(res, resolved);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  if (url === "/" || url === "/index.html") return serveFile(res, HARNESS_HTML);
  if (url === "/bundle.js") return serveFile(res, BUNDLE_PATH);
  if (url.startsWith("/fixtures/")) return serveFixture(res, url);
  res.writeHead(404, { ...CROSS_ORIGIN_ISOLATION_HEADERS, "content-type": "text/plain" });
  res.end("not found");
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<RunningServer> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      // text/plain so error text (which can echo the request path) is never
      // sniffed as HTML by the browser (CodeQL js/reflected-xss).
      res.writeHead(500, { ...CROSS_ORIGIN_ISOLATION_HEADERS, "content-type": "text/plain" });
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server failed to bind a TCP port");
  }
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

// Sanity check that fixture files actually exist before the browser starts
// requesting them — a clearer error than a wall of in-page fetch failures.
export async function assertFixturesGenerated(): Promise<void> {
  try {
    await stat(dataDir);
  } catch {
    throw new Error(`Fixture directory missing: ${dataDir}\nRun \`pnpm gen:fixtures\` first.`);
  }
}
