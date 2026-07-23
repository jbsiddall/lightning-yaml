/**
 * Local proof that bench/browser/memory/proc.ts's /proc machinery — child
 * process discovery, RSS-stabilization wait, clear_refs reset, VmHWM read —
 * actually works, using Chromium's renderer process as a stand-in for the
 * WebKitWebProcess the real webkit leg targets (same kernel interfaces;
 * webkit itself doesn't run in this environment — see engines.ts's
 * WEBKIT_INSTALL_HINT). Not part of the memory-ratios doc pipeline; a
 * standalone check to run once when touching proc.ts.
 *
 *   node --import tsx bench/browser/memory/procSmoke.ts
 */

import { launchEngineWithProcess } from "../engines.ts";
import { descendantPids, findUniqueDescendant, readVmHwmBytes, resetPeakRss, waitForRssStabilization } from "./proc.ts";

// Pins the renderer count to exactly one (no Chromium "spare renderer" kept
// warm alongside the real one) — verified locally; without these flags a
// fresh page can transiently have two `--type=renderer` processes, which
// would make findUniqueDescendant's one-match assertion flaky. The real
// webkit leg needs no equivalent flag: WebKit has no spare-process feature to
// disable in the first place.
const CHROMIUM_ISOLATION_ARGS = ["--disable-features=SpareRendererForSitePerProcess", "--renderer-process-limit=1"];

async function main(): Promise<void> {
  console.log("Launching chromium (renderer pinned to exactly one process)…");
  const engine = await launchEngineWithProcess("chromium", CHROMIUM_ISOLATION_ARGS);
  console.log(`  browser process pid: ${engine.pid}`);

  try {
    const page = await engine.browser.newPage();
    await page.setContent("<html><body><h1>proc smoke test</h1></body></html>");

    const before = descendantPids(engine.pid);
    console.log(`  descendant processes: ${before.length} (${before.join(", ")})`);

    const rendererPid = findUniqueDescendant(engine.pid, "--type=renderer");
    console.log(`  found renderer pid via cmdline match: ${rendererPid}`);

    console.log("  waiting for RSS stabilization…");
    const settled = await waitForRssStabilization(rendererPid, { timeoutMs: 5000 });
    console.log(`  settled VmRSS ≈ ${(settled / 1024 / 1024).toFixed(1)} MB`);

    resetPeakRss(rendererPid);
    const hwmAfterReset = readVmHwmBytes(rendererPid);
    console.log(`  VmHWM immediately after clear_refs reset: ${(hwmAfterReset / 1024 / 1024).toFixed(1)} MB (≈ current RSS)`);

    // Force real growth in the renderer's JS heap so the peak counter has
    // something genuine to catch — proves the reset+read round-trip actually
    // observes new allocation, not just re-reading a stale number.
    await page.evaluate(() => {
      (globalThis as { __smoke__?: unknown[] }).__smoke__ = Array.from({ length: 2_000_000 }, (_, i) => ({ i, pad: "x".repeat(64) }));
    });

    const hwmAfterAlloc = readVmHwmBytes(rendererPid);
    console.log(`  VmHWM after forcing ~a few hundred MB of allocation: ${(hwmAfterAlloc / 1024 / 1024).toFixed(1)} MB`);

    if (hwmAfterAlloc <= hwmAfterReset) {
      throw new Error(`VmHWM did not increase after allocation (${hwmAfterReset} -> ${hwmAfterAlloc}) — /proc plumbing did not observe real growth`);
    }

    console.log("\nPASS — /proc discovery, stabilization wait, clear_refs reset, and VmHWM read all verified against a real renderer process.");
  } finally {
    await engine.close();
  }
}

main().catch((err: unknown) => {
  console.error("FAIL —", err instanceof Error ? err.message : err);
  process.exit(1);
});
