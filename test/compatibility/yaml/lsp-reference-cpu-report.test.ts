import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bytes = readFileSync("docs/compatibility/reports/2026-11-19/lsp-reference-cpu-observations.json");
const result = JSON.parse(bytes.toString());
const sum = (rows: Record<string, { samples: number; intervalWeightedEstimateUs: number }>, key: "samples" | "intervalWeightedEstimateUs") =>
  Object.values(rows).reduce((total, row) => total + row[key], 0);

describe("terminal reference CPU publication", () => {
  it("binds the safe export to the dated report and excludes raw local paths", () => {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const report = readFileSync("docs/compatibility/reports/2026-11-19/lsp-reference-cpu.md", "utf8");
    expect(report).toContain(`data:${digest}`);
    expect(report).toContain(result.provenance.measuredHarness.head);
    expect(bytes.toString()).not.toMatch(/\/home\/|\/tmp\/|\/nix\/|file:\/\/|"scriptId"|"nodes"\s*:/);
    expect(result.provenance.hashes["captures/1.cpuprofile"]).toBe("fbd255e4e76cacde7c8d499e5dd85fc82077a02b4948b8d5ac09caad161263b1");
  });
  it("discloses the frozen collector length error separately from its verified digest", () => {
    const collector = result.provenance.sourceOwnership.modules.find((module: { id: string }) => module.id === "harness:lsp-reference-cpu-collector.mjs");
    expect(collector).toMatchObject({ recordedBytes: 2604, actualBytes: 3180,
      sha256: "9968f33988a09eb4823c63292a46112f89dae9adbf29c11eb6515f8b32d0b359" });
    expect(collector).not.toHaveProperty("bytes");
    expect(collector.lengthDiscrepancy).toContain("stale");
    expect(result.provenance.hashes["source-ownership.json"]).toBe("ab34bbf53cb4d3bacaccbb2552ed1be72ae922c52bfed6d33cf802065cc1a35d");
  });
  it("keeps the failed coverage screen and all unlaunched work visible", () => {
    expect(result.status).toBe("incomplete");
    expect(result.execution).toMatchObject({ attempts: 1, exit: 1, signal: null, externalTermination: false });
    expect(result.child).toMatchObject({ status: "completed", completedOperations: 1000, documentCount: 1, failure: null });
    expect(result.campaign.ledger.map((row: { fixture: string; repeat: number; state: string }) => [row.fixture, row.repeat, row.state])).toEqual([
      ["docker-compose-pihole-cloudflared-doh", 1, "incomplete"],
      ["kubernetes-zookeeper", 1, "pending"],
      ["github-actions-cmake-multi-platform", 1, "pending"],
      ["github-actions-cmake-multi-platform", 2, "pending"],
      ["kubernetes-zookeeper", 2, "pending"],
      ["docker-compose-pihole-cloudflared-doh", 2, "pending"],
    ]);
    for (const row of result.campaign.ledger.slice(1)) expect(row).toMatchObject({ completedOperations: 0, cleanup: "not-started", receiptSha256: null, artifactSha256: null });
    expect(result.audit.coverage).toEqual({ numerator: 452, denominator: 571, ratio: 452 / 571 });
    expect(result.audit.usefulSamples).toBeGreaterThanOrEqual(result.thresholds.minimumUsefulSamples);
    expect(result.audit.coverage.ratio).toBeLessThan(result.thresholds.minimumClassifiedCoverage);
    expect(result.audit.adequate).toBe(false);
  });
  it("reconciles interval residuals and preserves ancestry ambiguity without promoting coverage", () => {
    expect(sum(result.audit.exclusive, "samples")).toBe(result.audit.sampleCount);
    expect(sum(result.audit.exclusive, "intervalWeightedEstimateUs")).toBe(result.audit.clock.deltaSumUs);
    expect(result.audit.clock.deltaSumUs + result.audit.clock.trailingUnassignedUs).toBe(result.audit.clock.spanUs);
    expect(sum(result.independentDecoding.harnessGroups, "samples")).toBe(result.audit.exclusive.harness.samples);
    expect(sum(result.independentDecoding.harnessGroups, "intervalWeightedEstimateUs")).toBe(result.audit.exclusive.harness.intervalWeightedEstimateUs);
    expect(result.audit.nearestOwned.harness.samples).toBe(2);
    expect(result.audit.exclusive.harness.samples).toBe(86);
    expect(result.audit.operationSamples).toBe(454);
    expect(result.audit.classifiedSamples).toBe(452);
    const clocks = result.clocks;
    expect(BigInt(clocks.snapshots.wallEndNs) - BigInt(clocks.snapshots.wallStartNs)).toBe(BigInt(clocks.loopWallNs));
    expect(clocks.snapshots.cpuEnd.user - clocks.snapshots.cpuStart.user).toBe(clocks.processUserUs);
    expect(clocks.snapshots.cpuEnd.system - clocks.snapshots.cpuStart.system).toBe(clocks.processSystemUs);
  });
});
