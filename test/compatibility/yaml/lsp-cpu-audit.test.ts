import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verifyFrozenCpuAudit } from "../../../scripts/compatibility/verify-lsp-cpu-audit.mjs";
import { auditCpuProfile, sha256 } from "../../../scripts/compatibility/lsp-cpu-audit.mjs";

function fixture() {
  const frame = (functionName: string, url = "", lineNumber = -1) => ({ functionName, url, lineNumber, columnNumber: 0 });
  return { startTime: 100, endTime: 200, nodes: [
    { id: 1, callFrame: frame("(root)"), children: [2, 3, 4] },
    { id: 2, callFrame: frame("post", "node:inspector"), hitCount: 50 },
    { id: 3, callFrame: frame("(garbage collector)"), hitCount: 0 },
    { id: 4, callFrame: frame("runProfiledOperation", "/private/host/batch.mjs", 12), children: [5, 6, 7] },
    { id: 5, callFrame: frame("foldLines", "/private/pkg/resolve-flow-scalar.js", 75) },
    { id: 6, callFrame: frame("parseCustomTag", "/private/server/customTags.js", 13) },
    { id: 7, callFrame: frame("convertAST", "/private/server/ast-converter.js", 13), children: [8] },
    { id: 8, callFrame: frame("getCustomTagReturnType", "/private/server/customTags.js", 33) },
  ], samples: [2, 5, 3, 6, 8], timeDeltas: [40, 2, 10, 3, 5] };
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const run = (value: unknown) => { const bytes = encode(value); return auditCpuProfile(bytes, sha256(bytes)); };

describe("offline CPU clock and stack audit", () => {
  it("checks the digest before even parsing", () => {
    expect(() => auditCpuProfile(Buffer.from("not json"), "0".repeat(64))).toThrow("SHA256 mismatch");
  });
  it("separates unequal interval proxies, first observation, tail and hit counts", () => {
    const audit = run(fixture());
    expect(audit.sampleCount).toBe(5);
    expect(audit.nodeHitCountSum).toBe(50);
    expect(audit.clock).toEqual({ spanUs: 100, deltaSumUs: 60, firstObservationDeltaUs: 40,
      subsequentDeltaSumUs: 20, trailingUnassignedUs: 40, minDeltaUs: 2, maxDeltaUs: 40 });
  });
  it.each(["sample", "child", "cycle", "duplicate", "multipleParents", "forest"])("rejects malformed %s linkage", (kind) => {
    const profile = fixture();
    if (kind === "sample") profile.samples[1] = 999;
    if (kind === "child") profile.nodes[0].children!.push(999);
    if (kind === "cycle") profile.nodes[1].children = [1];
    if (kind === "duplicate") profile.nodes[1].id = 1;
    if (kind === "multipleParents") profile.nodes[1].children = [5];
    if (kind === "forest") profile.nodes[0].children = [2, 3];
    expect(() => run(profile)).toThrow(kind === "cycle" ? "cycle in profile tree" : undefined);
  });
  it.each(["missing", "short", "negative", "nonfinite", "overflow", "backwards"])("rejects %s clocks", (kind) => {
    const profile = fixture();
    if (kind === "missing") delete (profile as Partial<typeof profile>).timeDeltas;
    if (kind === "short") profile.timeDeltas.pop();
    if (kind === "negative") profile.timeDeltas[1] = -1;
    if (kind === "nonfinite") profile.timeDeltas[1] = Infinity;
    if (kind === "overflow") profile.timeDeltas[1] = 1000;
    if (kind === "backwards") profile.endTime = 99;
    expect(() => run(profile)).toThrow();
  });
  it("keeps detached GC, resolver filename bias and converter ancestry distinct", () => {
    const bytes = encode(fixture());
    const audit = auditCpuProfile(bytes, sha256(bytes), [
      { label: "boundary", frames: [{ functionName: "runProfiledOperation", file: "batch.mjs", line: 12, column: 0 }] },
      { label: "converter", frames: [{ functionName: "convertAST", file: "ast-converter.js", line: 13, column: 0 }] },
    ]);
    expect(audit.witnesses[0].ancestry).toEqual({ samples: 3, intervalProxyUs: 10,
      legacyCategories: { customCallbacks: 2, lexerParser: 1 } });
    expect(audit.witnesses[1].leaf.samples).toBe(0);
    expect(audit.witnesses[1].ancestry.samples).toBe(1);
    expect(audit.legacy.categories.runtimeGc).toBe(1);
    expect(audit.legacy.categories.serverAst).toBe(0);
    expect(JSON.stringify(audit)).not.toMatch(/private|host|pkg\//);
    const wrongLocation = [{ label: "wrong", frames: [{ functionName: "convertAST", file: "ast-converter.js", line: 14, column: 0 }] }];
    expect(() => auditCpuProfile(bytes, sha256(bytes), wrongLocation)).toThrow("witness frame absent");
    const renamed = fixture();
    renamed.nodes[4].callFrame.url = "/private/pkg/scalar.js";
    expect(run(renamed).legacy.categories.customCallbacks).toBe(1);
    expect(run(renamed).legacy.categories.composition).toBe(1);
  });
  it("rejects a pruned frozen export before reading any files", () => {
    expect(() => verifyFrozenCpuAudit("unused", { schema: "lsp-frozen-cpu-audit-v1", records: [] })).toThrow("frozen audit record set");
  });
  it.each(["candidate", "reference", "server-candidate", "server-reference"])("rejects changed %s caller document mode before replay", (participant) => {
    const manifest = JSON.parse(readFileSync(new URL("../../../docs/compatibility/reports/2026-11-18/lsp-cpu-audit.json", import.meta.url), "utf8"));
    manifest.records.find((record: any) => record.participant === participant).documentMode = "supplied";
    expect(() => verifyFrozenCpuAudit("unused", manifest)).toThrow("frozen operation document mode mismatch");
  });
  it("rejects a changed source pin for the frozen document mode", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../docs/compatibility/reports/2026-11-18/lsp-cpu-audit.json", import.meta.url), "utf8"));
    manifest.records[2].harness.head = "changed";
    expect(() => verifyFrozenCpuAudit("unused", manifest)).toThrow("frozen operation source mismatch");
  });
  it("publishes all four frozen recounts with private graph data omitted", () => {
    const text = readFileSync(new URL("../../../docs/compatibility/reports/2026-11-18/lsp-cpu-audit.json", import.meta.url), "utf8");
    const data = JSON.parse(text);
    expect(data.records.map((r: any) => r.audit.sampleCount)).toEqual([233, 273, 225, 268]);
    expect(data.records.map((r: any) => r.audit.clock.trailingUnassignedUs)).toEqual([712, 710, 1000, 882]);
    expect(data.records.map((r: any) => r.audit.witnesses.find((w: any) => w.label === "operation-boundary").ancestry.samples)).toEqual([212, 247, 212, 244]);
    expect(data.records.every((r: any) => r.documentMode === "absent")).toBe(true);
    expect(text).not.toMatch(/\/home\/|\/tmp\/|file:\/\/|https?:\/\/|"argv"|"nodes"|"root"/);
  });
});
