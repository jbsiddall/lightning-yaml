/**
 * Browser benchmark entry point. Bundled by bench/browser/build.ts into
 * generated/bundle.js and loaded as a module script by harness.html, inside a
 * page driven by bench/browser/run.ts (playwright-core). Mirrors
 * bench/speed/parse.bench.ts + stringify.bench.ts at BENCH_SCOPE=all (the
 * full competition matrix) — same candidate registry (bench/candidates.ts),
 * same applicability/support/handles gating, same mitata measurement core,
 * same trial-reduction math (bench/util/mitataTrial.ts). The only thing that
 * differs from the Node emitter is HOW fixtures reach the benchmark: a
 * browser can't `readFileSync`, so fixture text comes from `fetch()` against
 * the static server's `/fixtures/*` route instead.
 *
 * Communicates back to the driver via `window.__BENCH_RESULT__` /
 * `window.__BENCH_DONE__` (polled/read through playwright's page.evaluate) —
 * there's no other channel available from inside the page.
 */

import { bench, group, run, do_not_optimize } from "mitata";
import { selectCandidates, candidateApplies, candidateSupports, candidateHandles } from "../candidates.ts";
import { oracleParse } from "../oracle.ts";
import { reduceMitataTrial, rowsInOrder, type MitataTrial } from "../util/mitataTrial.ts";
import type { ManifestEntry, BrowserManifest } from "./manifest.ts";

declare global {
  interface Window {
    __BENCH_RESULT__?: BrowserBenchResult;
    __BENCH_DONE__?: boolean;
    __BENCH_ERROR__?: string;
  }
  // Injected by bench/browser/build.ts via esbuild `define` — a plain literal
  // substitution at bundle time, not a runtime import, so this file has no
  // dependency on a generated JSON file existing on disk for `tsc` to resolve
  // (bench/browser/generated/ is gitignored and only produced on demand).
  const __FIXTURE_MANIFEST__: BrowserManifest;
}

const manifest = __FIXTURE_MANIFEST__;

const OPS = ["parse", "stringify"] as const;

/**
 * Minimum positive delta between consecutive `performance.now()` reads, over
 * a short sampling window — the page's actual clock quantum. Chromium clamps
 * this to ~100µs without cross-origin isolation and unclamps it (~5µs or
 * finer) when `crossOriginIsolated` is true, which is why the static server
 * sends COOP/COEP on every response (see bench/browser/server.ts).
 */
function measureTimerResolutionMs(): number {
  let last = performance.now();
  let min = Infinity;
  const deadline = last + 50; // ~50ms probe budget — plenty of samples even at a coarse quantum.
  for (;;) {
    const now = performance.now();
    if (now >= deadline) break;
    const delta = now - last;
    if (delta > 0 && delta < min) min = delta;
    last = now;
  }
  return Number.isFinite(min) ? min : NaN;
}

async function fetchFixtureText(entry: ManifestEntry): Promise<string> {
  const res = await fetch(`/fixtures/${entry.name}${entry.ext}`);
  if (!res.ok) throw new Error(`fixture fetch failed: ${entry.name} (HTTP ${res.status})`);
  return res.text();
}

/** Mirrors fixtures/datasets.ts's loadFixtureValue: JSON.parse for `json`, the oracle for both YAML categories. */
function fixtureValueFromText(entry: ManifestEntry, text: string): unknown {
  return entry.category === "json" ? JSON.parse(text) : oracleParse(text);
}

interface BrowserBenchResult {
  operations: { parse: ReturnType<typeof rowsInOrder>; stringify: ReturnType<typeof rowsInOrder> };
  usedCandidates: string[];
  timerResolutionMs: number;
  crossOriginIsolated: boolean;
  skippedFixtures: { name: string; bytes: number }[];
}

async function main(): Promise<void> {
  const timerResolutionMs = measureTimerResolutionMs();

  // Full competition matrix (JSON baseline + js-yaml + js-yaml-tuned + yaml +
  // lightning-yaml) — the browser leg's whole point is a head-to-head, so
  // there's no "ours"/"competition" split like the Node scope env var; this
  // always mirrors `pnpm bench:competition`.
  const candidates = selectCandidates("all");
  const used = new Set<string>();
  const textCache = new Map<string, string>();

  for (const entry of manifest.included) {
    for (const op of OPS) {
      const applicable = candidates.filter(
        (c) => candidateApplies(c, entry.category, op) && candidateSupports(c, op),
      );
      if (applicable.length === 0) continue;

      let text = textCache.get(entry.name);
      if (text === undefined) {
        text = await fetchFixtureText(entry);
        textCache.set(entry.name, text);
      }
      const input: string | unknown = op === "parse" ? text : fixtureValueFromText(entry, text);

      const cands = applicable.filter((c) => candidateHandles(c, op, input, entry.category));
      if (cands.length === 0) continue;

      group(`${op} · ${entry.name}`, () => {
        for (const c of cands) {
          used.add(c.name);
          if (op === "parse") {
            bench(c.name, () => do_not_optimize(c.parse(input as string, entry.category)));
          } else {
            const stringify = c.stringify!; // candidateSupports(c, "stringify") above guarantees this.
            bench(c.name, () => do_not_optimize(stringify(input)));
          }
        }
      });
    }
  }

  // `throw: true` — see bench/speed/emit.ts's identical note: candidateHandles
  // filtering above means a bench should never actually throw, so surface it
  // loudly (as a page error the driver's console listener will catch) rather
  // than publish a bogus/missing row.
  const trial = (await run({ format: "quiet", throw: true })) as unknown as MitataTrial;
  const values = reduceMitataTrial(trial);
  const includedNames = manifest.included.map((e) => e.name);

  const result: BrowserBenchResult = {
    operations: {
      parse: rowsInOrder(values.parse, includedNames),
      stringify: rowsInOrder(values.stringify, includedNames),
    },
    usedCandidates: [...used],
    timerResolutionMs,
    crossOriginIsolated: self.crossOriginIsolated,
    skippedFixtures: manifest.skipped,
  };

  window.__BENCH_RESULT__ = result;
  window.__BENCH_DONE__ = true;
}

main().catch((err: unknown) => {
  window.__BENCH_ERROR__ = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  window.__BENCH_DONE__ = true;
});
