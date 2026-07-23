/**
 * Linux /proc introspection for the WebKit peak-RSS leg of the memory-ratios
 * harness (bench/browser/memoryRun.ts): finding the WebKitWebProcess child
 * that actually runs page JS, resetting the kernel's per-process peak-RSS
 * counter before a measured batch, and reading it back afterwards.
 *
 * webkit itself doesn't run in this environment (see engines.ts's
 * WEBKIT_INSTALL_HINT) — these functions are pure and OS-pid-generic, so
 * bench/browser/memory/procSmoke.ts exercises the exact same code against a
 * real Chromium renderer process as a local stand-in, proving the /proc
 * mechanics work even though the webkit leg itself only runs for real in CI.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

interface ProcNode {
  pid: number;
  ppid: number;
}

function readProcTree(): ProcNode[] {
  const nodes: ProcNode[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      // Format: "pid (comm) state ppid ...". `comm` can itself contain spaces
      // or parens, so match from the LAST ")" rather than splitting naively.
      const m = stat.match(/^\d+\s+\(.*\)\s+\S+\s+(\d+)/);
      if (!m) continue;
      nodes.push({ pid: Number(entry), ppid: Number(m[1]) });
    } catch {
      // The process exited between readdir and read — skip it, not fatal.
    }
  }
  return nodes;
}

/** Every descendant (children, grandchildren, ...) of `rootPid`, in BFS order. */
export function descendantPids(rootPid: number): number[] {
  const byParent = new Map<number, number[]>();
  for (const { pid, ppid } of readProcTree()) {
    const siblings = byParent.get(ppid);
    if (siblings) siblings.push(pid);
    else byParent.set(ppid, [pid]);
  }
  const out: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const child of byParent.get(p) ?? []) {
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

function cmdlineOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch {
    return "";
  }
}

/**
 * The single descendant of `rootPid` whose command line contains
 * `needle` (e.g. "WebKitWebProcess", or "--type=renderer" for the Chromium
 * stand-in used by the local smoke test). Throws if none or more than one
 * match — an ambiguous match would silently measure the wrong process, which
 * is worse than failing loudly (see procSmoke.ts for how the renderer count
 * is pinned to exactly one via Chromium launch flags).
 */
export function findUniqueDescendant(rootPid: number, needle: string): number {
  const matches = descendantPids(rootPid).filter((pid) => cmdlineOf(pid).includes(needle));
  if (matches.length === 0) {
    throw new Error(`no descendant of pid ${rootPid} with "${needle}" in its cmdline`);
  }
  if (matches.length > 1) {
    throw new Error(`${matches.length} descendants of pid ${rootPid} matched "${needle}" (${matches.join(", ")}) — expected exactly one`);
  }
  return matches[0];
}

function readStatusField(pid: number, field: string): number {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  // e.g. "VmHWM:       176196 kB" — every Vm* field in /proc/<pid>/status is kB.
  const line = status.split("\n").find((l) => l.startsWith(`${field}:`));
  if (!line) throw new Error(`/proc/${pid}/status has no ${field} line`);
  const m = line.match(/(\d+)\s*kB/);
  if (!m) throw new Error(`unexpected ${field} line format: ${line}`);
  return Number(m[1]) * 1024;
}

/** Current resident set size, in bytes. */
export function readVmRssBytes(pid: number): number {
  return readStatusField(pid, "VmRSS");
}

/** Peak resident set size since the process started, or since the last `resetPeakRss`, in bytes. */
export function readVmHwmBytes(pid: number): number {
  return readStatusField(pid, "VmHWM");
}

/**
 * Resets the kernel's per-process high-water-mark counters (VmHWM among
 * them) by writing "5" to /proc/<pid>/clear_refs — documented in
 * `man 5 proc` under /proc/pid/clear_refs. Requires CAP_SYS_PTRACE-equivalent
 * access to the target pid (true for a same-user child process, which is
 * what both the real webkit leg and the smoke test use).
 */
export function resetPeakRss(pid: number): void {
  writeFileSync(`/proc/${pid}/clear_refs`, "5");
}

export interface StabilizationOptions {
  /** Fractional tolerance between consecutive samples to call it settled (default 1%). */
  tolerance?: number;
  /** Consecutive within-tolerance samples required (default 3). */
  requiredSamples?: number;
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Polls VmRSS until `requiredSamples` consecutive readings land within
 * `tolerance` of each other, or gives up at `timeoutMs` (returning the last
 * reading regardless — a soft budget, not a hard requirement: a process that
 * never fully settles still gets measured, just with a noisier baseline,
 * rather than the whole run failing). This is what lets a WebKitWebProcess's
 * initial-load/JIT-warmup churn (and Chromium's renderer-startup churn in the
 * smoke test) finish before the peak-RSS counter is reset for the real batch.
 */
export async function waitForRssStabilization(pid: number, opts: StabilizationOptions = {}): Promise<number> {
  const { tolerance = 0.01, requiredSamples = 3, intervalMs = 200, timeoutMs = 10_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  let settled = 0;
  let last = readVmRssBytes(pid);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const sample = readVmRssBytes(pid);
    const delta = Math.abs(sample - last) / Math.max(last, 1);
    settled = delta <= tolerance ? settled + 1 : 0;
    last = sample;
    if (settled >= requiredSamples) return last;
  }
  return last;
}
