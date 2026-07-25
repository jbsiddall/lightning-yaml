/**
 * Linux /proc plumbing for the webkit peak-RSS leg (bench/browser/memoryRun.ts): find the
 * browser child running page JS, reset the kernel's peak-RSS counter, read it back after.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

function descendantPids(rootPid: number): number[] {
  const byParent = new Map<number, number[]>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch {
      continue; // exited between readdir and read
    }
    // "pid (comm) state ppid …" — `comm` can itself hold spaces and parens, so match past the LAST ")".
    const ppid = stat.match(/^\d+\s+\(.*\)\s+\S+\s+(\d+)/)?.[1];
    if (ppid === undefined) continue;
    const siblings = byParent.get(Number(ppid));
    if (siblings) siblings.push(Number(entry));
    else byParent.set(Number(ppid), [Number(entry)]);
  }

  const out: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
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

/** Descendants of `rootPid` whose cmdline contains `needle`. Snapshot this before opening a page, then pass it to `selectPageProcess`. */
export function matchingDescendants(rootPid: number, needle: string): number[] {
  return descendantPids(rootPid).filter((pid) => cmdlineOf(pid).includes(needle));
}

/**
 * The content process serving a page that was opened after `before` was snapshotted.
 * Uniqueness is NOT a safe assumption to select on: both engines keep spare/prewarmed
 * content processes alive alongside the active one, persistently — measured on chromium,
 * two `--type=renderer` children for every sample of a single open page's lifetime. So
 * prefer a pid that appeared since the snapshot, and fall back to the heaviest match when
 * the engine reused an existing process instead of spawning one.
 */
export function selectPageProcess(rootPid: number, needle: string, before: readonly number[]): number {
  const matches = matchingDescendants(rootPid, needle);
  if (matches.length === 0) throw new Error(`no descendant of pid ${rootPid} has "${needle}" in its cmdline`);
  const seen = new Set(before);
  const appeared = matches.filter((pid) => !seen.has(pid));
  const pool = appeared.length > 0 ? appeared : matches;
  return pool.reduce((a, b) => (readVmFieldBytes(a, "VmRSS") >= readVmFieldBytes(b, "VmRSS") ? a : b));
}

function readVmFieldBytes(pid: number, field: "VmRSS" | "VmHWM"): number {
  const line = readFileSync(`/proc/${pid}/status`, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${field}:`));
  const m = line?.match(/(\d+)\s*kB/);
  if (!m) throw new Error(`no usable ${field} line in /proc/${pid}/status: ${line ?? "(absent)"}`);
  return Number(m[1]) * 1024;
}

/** Peak resident set size since the process started, or since the last `resetPeakRss`. */
export function readVmHwmBytes(pid: number): number {
  return readVmFieldBytes(pid, "VmHWM");
}

/** Drops the kernel's peak-RSS counter back to current RSS (`man 5 proc`, /proc/pid/clear_refs). */
export function resetPeakRss(pid: number): void {
  writeFileSync(`/proc/${pid}/clear_refs`, "5");
}

const SETTLE_INTERVAL_MS = 200;
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * Waits out a fresh page process's startup and JIT churn so it isn't counted as parse memory.
 * Gives up at the timeout rather than failing the run — a noisier baseline beats no measurement.
 */
export async function waitForRssStabilization(pid: number): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let settled = 0;
  let last = readVmFieldBytes(pid, "VmRSS");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SETTLE_INTERVAL_MS));
    const sample = readVmFieldBytes(pid, "VmRSS");
    settled = Math.abs(sample - last) / Math.max(last, 1) <= 0.01 ? settled + 1 : 0; // settled = 3 consecutive samples within 1%
    last = sample;
    if (settled >= 3) return;
  }
}
