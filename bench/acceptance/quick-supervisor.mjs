import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const blankResult = () => ({ protocol: "quick-estimate-v1", status: "incomplete", rows: { cpu: [], memory: [] }, errors: [] });
const atomicWrite = (path, value) => {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
};

export async function supervise({ command, args, cwd, env = process.env, out, groupsFile = `${out}.children`, limitMs = 60_000, stdio = "ignore" }) {
  const started = process.hrtime.bigint();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(groupsFile, "");
  atomicWrite(out, { ...blankResult(), startedAt: new Date().toISOString(), deadlineMs: limitMs });
  const child = spawn(command, args, { cwd, env: { ...env, LY_QUICK_ACTIVE_GROUPS: groupsFile }, detached: true, stdio });
  let stopReason;
  let killTimer;
  let killComplete;
  let finishKill;
  const killSnapshot = (signal, pids) => {
    for (const pid of pids) {
      try { process.kill(-Number(pid), signal); } catch {}
    }
  };
  const beginStop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    const pids = [String(child.pid)];
    if (existsSync(groupsFile)) pids.push(...readFileSync(groupsFile, "utf8").trim().split(/\s+/).filter(Boolean));
    killSnapshot("SIGTERM", pids);
    killComplete = new Promise((resolve) => { finishKill = resolve; });
    killTimer = setTimeout(() => { killSnapshot("SIGKILL", pids); finishKill(); }, 250);
  };
  const onInterrupt = (signal) => beginStop(signal);
  const watchdog = setTimeout(() => beginStop("deadline"), Math.max(10, limitMs - 1_500));
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (stopReason) await killComplete;
    else {
      const active = existsSync(groupsFile) ? readFileSync(groupsFile, "utf8").trim().split(/\s+/).filter(Boolean) : [];
      if (active.length) {
        killSnapshot("SIGTERM", active);
        await new Promise((resolve) => setTimeout(resolve, 250));
        killSnapshot("SIGKILL", active);
      }
    }
  } finally {
    clearTimeout(watchdog);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    if (killTimer) clearTimeout(killTimer);
  }
  const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  let record;
  try { record = JSON.parse(readFileSync(out, "utf8")); } catch { record = blankResult(); }
  if (stopReason === "deadline") {
    record.status = "timed-out";
    record.errors = [...(record.errors ?? []), "external 60-second watchdog stopped the benchmark process tree"];
  } else if (stopReason) {
    record.status = "interrupted";
    record.errors = [...(record.errors ?? []), `benchmark stopped by ${stopReason}`];
  } else if (result.code !== 0) {
    record.status = "error";
    record.errors = [...(record.errors ?? []), `runner exited ${result.code ?? result.signal}`];
  }
  record.elapsedMs = elapsedMs;
  atomicWrite(out, record);
  try { writeFileSync(groupsFile, ""); } catch {}
  return { status: record.status, elapsedMs, code: result.code, signal: result.signal, exitCode: record.status === "complete" ? 0 : record.status === "interrupted" ? 130 : record.status === "timed-out" ? 1 : result.code || 1, record };
}
