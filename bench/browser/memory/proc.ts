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

/** Largest peak-RSS growth across the browser's content processes while `body` runs — WebKit keeps a prewarmed sibling that neither "newest" nor "heaviest right now" tells from the active one (measured: idle grew 0 KB, active 174 MB), so reset and read every match and let the idle ones contribute their ~0. */
export async function peakRssGrowthDuring(rootPid: number, needles: readonly string[], body: () => Promise<void>): Promise<number> {
  const all = descendantPids(rootPid);
  const pids = all.filter((pid) => needles.some((n) => cmdlineOf(pid).includes(n)));
  if (pids.length === 0) {
    // Print the tree: the one time this fired, the needle was just the wrong process name for this port, and a bare "not found" said nothing useful.
    const tree = all.map((pid) => `    ${pid}  ${cmdlineOf(pid).trim().slice(0, 120)}`);
    throw new Error(
      `no descendant of pid ${rootPid} matches ${needles.map((n) => `"${n}"`).join(" or ")}. Descendants:\n${tree.join("\n") || "    (none)"}`,
    );
  }

  await Promise.all(pids.map((pid) => waitForRssStabilization(pid)));
  const baselines = pids.map((pid) => {
    resetPeakRss(pid);
    return [pid, readVmHwmBytes(pid)] as const;
  });

  await body();

  return Math.max(
    ...baselines.map(([pid, baseline]) => {
      try {
        return readVmHwmBytes(pid) - baseline;
      } catch {
        return 0; // a content process that exited mid-batch measured nothing
      }
    }),
  );
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
function readVmHwmBytes(pid: number): number {
  return readVmFieldBytes(pid, "VmHWM");
}

/** Drops the kernel's peak-RSS counter back to current RSS (`man 5 proc`, /proc/pid/clear_refs). */
function resetPeakRss(pid: number): void {
  writeFileSync(`/proc/${pid}/clear_refs`, "5");
}

const SETTLE_INTERVAL_MS = 200;
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * Waits out a fresh page process's startup and JIT churn so it isn't counted as parse memory.
 * Gives up at the timeout rather than failing the run — a noisier baseline beats no measurement.
 */
async function waitForRssStabilization(pid: number): Promise<void> {
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
