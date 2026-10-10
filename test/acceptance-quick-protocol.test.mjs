import assert from "node:assert/strict";
import { test } from "node:test";
import { CPU_ROWS, LIMIT_MS, MEMORY_ROWS, runChild, summarize, validateCpuRows, assertDiagnosticParity } from "../bench/acceptance/quick-runner.mjs";
import { supervise } from "../bench/acceptance/quick-supervisor.mjs";
import { diagnosticInputs } from "../bench/acceptance/profile-workloads.mjs";

const baseCpu = Object.fromEntries(CPU_ROWS.map((key) => [key, { medianNsPerCall: 100 }]));
const candidateCpu = Object.fromEntries(CPU_ROWS.map((key) => [key, { medianNsPerCall: 120 }]));
const memoryRows = [];
for (let round = 1; round <= 3; round++) for (const key of MEMORY_ROWS) {
  memoryRows.push({ round, side: "baseline", key, peakRssBytes: 100_000, heapDeltaBytes: 8_000 });
  memoryRows.push({ round, side: "candidate", key, peakRssBytes: 110_000, heapDeltaBytes: 10_000 });
}

test("quick protocol pins representative rows and summarizes paired estimates", () => {
  assert.equal(LIMIT_MS, 60_000);
  assert.equal(CPU_ROWS.length, 9);
  assert.equal(MEMORY_ROWS.length, 4);
  const cpu = [];
  for (let round = 1; round <= 3; round++) {
    cpu.push({ round, side: "baseline", rows: baseCpu }, { round, side: "candidate", rows: candidateCpu });
  }
  const summary = summarize({ cpu, memory: memoryRows });
  const protocol = Object.fromEntries(CPU_ROWS.map((key) => [key, { warmupCalls: 24, warmupElapsedNs: 250_000_000, batchCalls: [1, 2, 3, 4, 5], batchElapsedNs: [80_000_000, 160_000_000, 240_000_000, 320_000_000, 400_000_000], nsPerCall: [80_000_000, 80_000_000, 80_000_000, 80_000_000, 80_000_000], medianNsPerCall: 80_000_000 }]));
  validateCpuRows(protocol);
  protocol[CPU_ROWS[0]].medianNsPerCall = 29;
  assert.throws(() => validateCpuRows(protocol), /median/);
  assert.equal(summary.cpu[CPU_ROWS[0]].medianRatio, 1.2);
  assert.deepEqual(summary.cpu[CPU_ROWS[0]].ratioRange, [1.2, 1.2]);
  assert.equal(summary.memory[MEMORY_ROWS[0]].medianHeapExcessBytes, 2_000);
  assert.equal(summary.memory[MEMORY_ROWS[0]].medianHeapRatio, 1.25);
  assert.match(summary.interpretation, /Quick estimate/);
});

test("tiny retained heap baselines report bytes without ratios", () => {
  const rows = MEMORY_ROWS.flatMap((key) => [
    { round: 1, side: "baseline", key, peakRssBytes: 1, heapDeltaBytes: 100 },
    { round: 1, side: "candidate", key, peakRssBytes: 2, heapDeltaBytes: 200 },
  ]);
  const summary = summarize({ cpu: [], memory: rows });
  assert.equal(summary.memory[MEMORY_ROWS[0]].medianHeapRatio, null);
  assert.equal(summary.memory[MEMORY_ROWS[0]].medianHeapExcessBytes, null);
  assert.equal(summary.memory[MEMORY_ROWS[0]].pairs[0].heapDeltaBytes.excess, 100);
});

test("worker deadline terminates its process group and preserves timeout state", async () => {
  const deadline = Number(process.hrtime.bigint() / 1_000_000n) + 100;
  await assert.rejects(runChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], deadline), (error) => error.timedOut === true);
});

test("worker timeout kills a SIGTERM-resistant descendant", async () => {
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "quick-worker-test-"));
  const marker = join(dir, "survived");
  const descendant = "process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'leaked'),450);setInterval(()=>{},1000)";
  const parent = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(descendant)},${JSON.stringify(marker)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  try {
    const deadline = Number(process.hrtime.bigint() / 1_000_000n) + 100;
    await assert.rejects(runChild(process.execPath, ["-e", parent], deadline), (error) => error.timedOut === true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(existsSync(marker), false, "descendant survived the timeout cleanup");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("external watchdog bounds blocked work and preserves the partial record", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "quick-supervisor-test-"));
  const out = join(dir, "result.json");
  const partial = JSON.stringify({ protocol: "quick-estimate-v1", status: "incomplete", rows: { cpu: [{ partial: true }], memory: [] }, errors: [] });
  try {
    const code = `require('node:fs').writeFileSync(${JSON.stringify(out)},${JSON.stringify(partial)});while(true){}`;
    const result = await supervise({ command: process.execPath, args: ["-e", code], out, cwd: dir, limitMs: 1_750 });
    const record = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(result.status, "timed-out");
    assert.equal(record.status, "timed-out");
    assert.equal(record.rows.cpu.length, 1);
    assert.ok(result.elapsedMs < 1_500);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("supervisor propagates a failed runner", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "quick-supervisor-test-"));
  const out = join(dir, "result.json");
  try {
    const result = await supervise({ command: process.execPath, args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(out)},JSON.stringify({protocol:"quick-estimate-v1",status:"complete",rows:{cpu:[],memory:[]},errors:[]}));process.exit(7)`], out, cwd: dir, limitMs: 3_000 });
    assert.equal(result.exitCode, 7);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).status, "error");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("diagnostic preflight rejects a wrong unescaped-longquotes result", () => {
  assert.ok(CPU_ROWS.includes("diagnostic.parse · unescaped-longquotes"));
  const unescaped = diagnosticInputs.find(({ name }) => name === "unescaped-longquotes").text;
  const parse = (text) => ({ value: text === unescaped ? "correct unescaped" : "escaped result" });
  const baseline = { parse };
  const candidate = { parse: (text) => ({ value: text === unescaped ? "wrong unescaped" : parse(text).value }) };
  assert.throws(() => assertDiagnosticParity(baseline, candidate), /unescaped-longquotes/);
});

test("worker close kills a ready SIGTERM-resistant stdio-ignored descendant", async () => {
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "quick-worker-close-test-"));
  const ready = join(dir, "ready");
  const marker = join(dir, "survived");
  const descendant = "const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[1],'ready');setTimeout(()=>fs.writeFileSync(process.argv[2],'leaked'),500);setInterval(()=>{},1000)";
  const parent = `const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',${JSON.stringify(descendant)},${JSON.stringify(ready)},${JSON.stringify(marker)}],{stdio:'ignore'});const poll=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(poll);fs.writeSync(1,JSON.stringify({ready:true})+'\\n');process.exit(0)}},2);`;
  try {
    const result = await runChild(process.execPath, ["-e", parent], Number(process.hrtime.bigint() / 1_000_000n) + 2_000);
    assert.deepEqual(result, { ready: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(existsSync(marker), false, "descendant survived normal leader exit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
