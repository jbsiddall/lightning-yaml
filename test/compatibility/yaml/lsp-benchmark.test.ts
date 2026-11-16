import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as yaml from "yaml";
import * as sourceYaml from "../../../src/yaml-compat.ts";
import {
  assertCstLossless,
  assertProviderDocument,
  assertRootScalarValue,
  assertAliasResolvesTo,
  assertCustomTagReturnType,
  assertDiagnosticPosition,
  assertLineStarts,
  assertYamlProvider,
  assertYamlResolutions,
  createYamlResolverHook,
  getRegisterHooks,
  runBareOperation,
  validateWorkerEnvelope,
  finalizeCellLedger,
} from "../../../scripts/compatibility/lsp-contract.mjs";
import {
  expandDocumentStream,
  loadPinnedCorpus,
  enumerateCells,
  semanticSources,
} from "../../../scripts/compatibility/lsp-fixtures.mjs";
import {
  createCampaignBudget,
  createPairedSchedule,
  evaluateSemanticPair,
  expectedPhaseCounts,
  finalizeMeasurementReport,
  finalizeScheduleLedger,
  isMatchedPolicySemanticMismatch,
  runMeasurementPhase,
  selectPairedSchedule,
  semanticOutcomesEqual,
  snapshotPublicValue,
  validatePhaseResult,
  verifyInputBytes,
} from "../../../scripts/compatibility/lsp-measure.mjs";
import {
  censusOwnGraph,
  canonicalFreshArtifactPath,
  classifyCpuSamples,
  collectCpuProfile,
  createDiagnosticBudget,
  createFileSink,
  redactPrivatePaths,
  validateDiagnosticRequest,
  validateDiagnosticWorker,
  writeHeapSnapshot,
} from "../../../scripts/compatibility/lsp-diagnostics.mjs";

const root = process.cwd();

describe("maintained LSP compatibility contract", () => {
  it("loads only byte-pinned corpus files and expands whole documents reproducibly", () => {
    const fixtures = loadPinnedCorpus(root);
    expect(fixtures.map(({ id }) => id)).toEqual([
      "docker-compose-pihole-cloudflared-doh",
      "kubernetes-zookeeper",
      "github-actions-cmake-multi-platform",
    ]);
    const scaled = expandDocumentStream(fixtures[2]!, 312);
    const medium = expandDocumentStream(fixtures[2]!, 30);
    expect(medium.bytes).toBe(100_825);
    expect(scaled.bytes).toBe(1_048_627);
    expect(scaled.source.split("\n---\n")).toHaveLength(312);
    expect(scaled.repeatCount).toBe(312);
    expect(runBareOperation(yaml, scaled.source).documents).toHaveLength(312);
    expect(() => expandDocumentStream(fixtures[2]!, 1001)).toThrow(/copies/);
    expect(enumerateCells("bare-corpus")).toHaveLength(3);
    expect(enumerateCells("bare-scale")).toHaveLength(2);
    expect(enumerateCells("bare-matched-corpus")).toHaveLength(6);
    expect(enumerateCells("bare-matched-scale")).toHaveLength(4);
    expect(enumerateCells("bare-policy")).toHaveLength(6);
    expect(enumerateCells("lsp-consumer")).toHaveLength(12);
    expect(enumerateCells("lsp-consumer").every((cell) => !("provider" in cell))).toBe(true);
  });

  it("uses one explicit paired repeat schedule for plans, selection, and observations", () => {
    const participants = ["candidate", "reference"];
    const phases = ["cpu-wall", "retained-heap", "isolated-peak-rss"];
    expect(() => createPairedSchedule([], { repeatCount: 1, participants, phases })).toThrow(/between 2 and 5/);
    expect(() => createPairedSchedule([], { repeatCount: 6, participants, phases })).toThrow(/between 2 and 5/);
    for (const batch of ["bare-scale", "bare-matched-corpus", "bare-matched-scale", "bare-policy", "lsp-consumer"]) {
      const cells = enumerateCells(batch);
      const schedule = createPairedSchedule(cells, { repeatCount: 2, participants, phases });
      expect(schedule).toHaveLength(cells.length * 2 * 2 * phases.length);
      expect(new Set(schedule.map((item) => item.observationId)).size).toBe(schedule.length);
      const caseOrder = (repeatIndex: number) => [...new Set(schedule.filter((item) => item.repeatIndex === repeatIndex).map((item) => item.cellId))];
      expect(caseOrder(1)).toEqual(cells.map((cell) => cell.id));
      expect(caseOrder(2)).toEqual(cells.map((cell) => cell.id).reverse());
      for (const cell of cells) {
        for (const phase of phases) {
          const orderFor = (repeatIndex: number) => schedule.filter((item) => item.cellId === cell.id && item.phase === phase && item.repeatIndex === repeatIndex).map((item) => item.participant);
          expect(orderFor(1)).toEqual(participants);
          expect(orderFor(2)).toEqual([...participants].reverse());
        }
        for (const repeatIndex of [1, 2]) {
          const order = repeatIndex === 1 ? participants : [...participants].reverse();
          const actual = schedule.filter((item) => item.cellId === cell.id && item.repeatIndex === repeatIndex).map((item) => `${item.phase}:${item.participant}`);
          expect(actual).toEqual(phases.flatMap((phase) => order.map((participant) => `${phase}:${participant}`)));
        }
      }
      const chosenCell = cells[0]!;
      const selected = [chosenCell.id];
      const selectedSchedule = selectPairedSchedule(schedule, selected);
      expect(selectedSchedule).toHaveLength(2 * 2 * phases.length);
      expect(selectedSchedule).toEqual(schedule.filter((item) => selected.includes(item.cellId)));
      expect(() => selectPairedSchedule(schedule, ["unknown-case"])).toThrow(/unplanned cell/);
      const first = selectedSchedule[0]!;
      const failed = selectedSchedule[1]!;
      const ledger = finalizeScheduleLedger(schedule, selectedSchedule, [first.observationId]);
      expect(ledger.completed).toEqual([first.observationId]);
      expect(ledger.pending).toEqual(selectedSchedule.slice(1).map((item) => item.observationId));
      const failedLedger = finalizeScheduleLedger(schedule, selectedSchedule, [first.observationId], [failed.observationId]);
      expect(failedLedger.failed).toEqual([failed.observationId]);
      expect(failedLedger.pending).toEqual(selectedSchedule.slice(2).map((item) => item.observationId));
      expect(ledger.notSelected).toHaveLength((cells.length - 1) * 2 * 2 * phases.length);
    }
  });

  it("finalizes an incomplete measurement report when semantic preflight fails", () => {
    const schedule = [{ cellId: "cell-a", observationId: "cell-a:repeat:1:candidate:cpu-wall" }];
    const phaseLedger = finalizeScheduleLedger(schedule, schedule);
    const report = finalizeMeasurementReport({
      preflightComplete: false,
      batch: "bare-matched-corpus",
      participants: ["candidate", "reference"],
      protocol: { repeats: 2 },
      plannedCellIds: ["cell-a", "cell-b"],
      selectedCellIds: ["cell-a"],
      plannedSchedule: schedule,
      selectedSchedule: schedule,
      phaseLedger,
      failedPhases: [{ id: "cell-a:semantic-preflight:candidate", error: "preflight failed" }],
      completedPhaseIds: [],
      candidateArtifactsBefore: {},
      candidateArtifactsAfter: {},
      serverArtifactsBefore: {},
      serverArtifactsAfter: {},
      eligibility: [{ id: "cell-a", performanceEligible: false }],
      semanticComparisons: [],
      rawObservations: [],
      semanticPreflight: [],
      elapsedMs: 5
    });
    expect(report).toMatchObject({
      kind: "lsp-measurement",
      status: "incomplete",
      scoredMeasurement: true,
      planned: ["cell-a", "cell-b"],
      selected: ["cell-a"],
      notSelected: ["cell-b"],
      cells: { failed: ["cell-a"], pending: [] },
      phases: { pending: ["cell-a:repeat:1:candidate:cpu-wall"] },
      rawObservations: [],
      semanticPreflight: [],
      measurementClaim: null
    });
  });

  it("asserts the direct parser/composer operation and independent UTF-16 source witness", () => {
    assertYamlProvider(yaml, "stock yaml");
    const source = semanticSources.crlfEmoji;
    const result = runBareOperation(yaml, source, { captureLineCallbacks: true });
    expect(result.documents).toHaveLength(1);
    expect(result.callbacks).toEqual(result.lineCounter.lineStarts);
    expect(assertCstLossless(yaml, result.tokens, source).utf16Length).toBe(source.length);
    expect(() => assertCstLossless(yaml, result.tokens, `${source}x`)).toThrow(/lost or changed/);
    const crOnly = semanticSources.callbackCrOnlyFinalLine;
    const crOnlyResult = runBareOperation(yaml, crOnly, { captureLineCallbacks: true, document: {} });
    expect(crOnlyResult.finalLineEmpty).toBe(true);
    expect(crOnlyResult.callbacks).toEqual([]);
    expect(crOnlyResult.lineCounter.lineStarts).toEqual([]);
  });

  it("checks root scalar semantics independently of unchanged CST source tokens", () => {
    const source = semanticSources.rootIndent;
    const result = runBareOperation(yaml, source);
    const document = result.documents[0]!;
    expect(assertRootScalarValue(yaml, document, result.tokens, "hello\n").value).toBe("hello\n");
    expect(yaml.CST.resolveAsScalar(document.contents!.srcToken!, false).value).toBe("hello\n");
    const originalToken = document.contents!.srcToken;
    document.contents!.value = "wrong\n";
    expect(document.contents!.srcToken).toBe(originalToken);
    expect(() => assertRootScalarValue(yaml, document, result.tokens, "hello\n")).toThrow(/root scalar value changed/);
  });

  it("rejects shifted callbacks and diagnostics, broken aliases, and changed tag metadata", () => {
    const callbackSource = semanticSources.crlfEmoji;
    const callbackResult = runBareOperation(yaml, callbackSource, { captureLineCallbacks: true });
    assertLineStarts(callbackResult.callbacks, callbackResult.lineCounter.lineStarts);
    expect(() => assertLineStarts(callbackResult.callbacks.slice(1), callbackResult.lineCounter.lineStarts)).toThrow(/callback offsets/);

    const malformed = runBareOperation(yaml, 'x: "😀"\r\nbad: [1,\r\n');
    const diagnostic = malformed.documents[0]!.errors.find((error: { code: string }) => error.code === "BAD_INDENT")!;
    assertDiagnosticPosition(malformed.documents[0], "BAD_INDENT", [19, 20]);
    diagnostic.pos = [18, 19];
    expect(() => assertDiagnosticPosition(malformed.documents[0], "BAD_INDENT", [19, 20])).toThrow(/position changed/);

    const aliasSource = semanticSources.aliases;
    const aliasResult = runBareOperation(yaml, aliasSource);
    const aliasDoc = aliasResult.documents[0]!;
    const aliasMap = aliasDoc.contents as yaml.YAMLMap;
    const anchor = (aliasMap.items as any[]).find((pair) => pair.key?.value === "anchor")!.value as any;
    const alias = assertAliasResolvesTo(yaml, aliasDoc, aliasResult.tokens, anchor);
    alias.source = "missing";
    expect(() => assertAliasResolvesTo(yaml, aliasDoc, aliasResult.tokens, anchor)).toThrow();

    const tagged = runBareOperation(yaml, "value: !count 12\n", {
      customTags: [{ tag: "!count", resolve: (value: string) => {
        const scalar = new yaml.Scalar(value);
        (scalar as any).customTagReturnType = "number";
        return scalar;
      } }],
    });
    const taggedScalar = (tagged.documents[0]!.contents as yaml.YAMLMap).items[0]!.value as any;
    assertCustomTagReturnType(taggedScalar, "number");
    taggedScalar.customTagReturnType = "string";
    expect(() => assertCustomTagReturnType(taggedScalar, "number")).toThrow(/return type changed/);
  });

  it("rejects wrong provider brands, detached source tokens and non-array collection items", () => {
    const source = "root: {value: 1}\n";
    const tokens = [...new yaml.Parser().parse(source)];
    const document = [...new yaml.Composer({ keepSourceTokens: true }).compose(tokens, true, source.length)][0]!;
    expect(() => assertProviderDocument(sourceYaml as never, document, tokens)).toThrow(/provider brand/);

    const map = document.contents as yaml.YAMLMap;
    const pair = map.items[0]!;
    const originalToken = pair.srcToken;
    pair.srcToken = structuredClone(originalToken);
    expect(() => assertProviderDocument(yaml, document, tokens)).toThrow(/Parser-produced token/);
    pair.srcToken = originalToken;

    const originalItems = map.items;
    map.items = { length: 1 } as never;
    expect(() => assertProviderDocument(yaml, document, tokens)).toThrow(/ordinary mutable arrays/);
    map.items = originalItems;
    expect(assertProviderDocument(yaml, document, tokens).tokenIdentity).toBe(true);
  });

  it("fails clearly when the shipped main YAML shim lacks Composer and Document APIs", () => {
    expect(() => assertYamlProvider(sourceYaml as never, "main yaml shim"))
      .toThrow(/Composer\/Document support absent/);
  });

  it("runs the maintained semantic self-check without claiming candidate compatibility", () => {
    const script = resolve(root, "scripts/compatibility/bench-lsp.mjs");
    const child = spawnSync(process.execPath, [script, "--check", "--self-check"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.kind).toBe("contract-self-check");
    expect(result.candidateCompatibility).toBe(false);
    expect(result.scoredMeasurement).toBe(false);
    expect(result.evidence.rootIndent.composerValue).toBe("hello\n");
  });

  it("rejects malformed worker identities, missing checksums and incomplete cell ledgers", () => {
    expect(() => validateWorkerEnvelope("{broken", { workerId: "reference", expectedHead: "abc", cellIds: ["one"] }))
      .toThrow(/invalid JSON/);
    const valid = JSON.stringify({
      workerId: "reference",
      head: "abc",
      cells: [{ id: "one", inputSha256: "a".repeat(64), outputSha256: "b".repeat(64) }],
    });
    expect(validateWorkerEnvelope(valid, { workerId: "reference", expectedHead: "abc", cellIds: ["one"] }).cells).toHaveLength(1);
    expect(() => validateWorkerEnvelope(valid, { workerId: "candidate", expectedHead: "abc", cellIds: ["one"] })).toThrow(/ID mismatch/);
    expect(() => validateWorkerEnvelope(valid, { workerId: "reference", expectedHead: "bad", cellIds: ["one"] })).toThrow(/HEAD/);
    expect(() => validateWorkerEnvelope(valid, { workerId: "reference", expectedHead: "abc", cellIds: ["one"], expectedInputSha256: { one: "c".repeat(64) } })).toThrow(/input checksum/);
    expect(() => validateWorkerEnvelope(JSON.stringify({ workerId: "reference", head: "abc", cells: [
      { id: "one", inputSha256: "bad", outputSha256: "b".repeat(64) },
    ] }), { workerId: "reference", expectedHead: "abc", cellIds: ["one"] })).toThrow(/valid SHA-256/);
    expect(() => validateWorkerEnvelope(JSON.stringify({ workerId: "reference", head: "abc", cells: [] }), {
      workerId: "reference", expectedHead: "abc", cellIds: ["one"],
    })).toThrow(/omitted planned cell/);
    expect(() => validateWorkerEnvelope(JSON.stringify({ workerId: "reference", head: "abc", cells: [
      { id: "other", inputSha256: "a".repeat(64), outputSha256: "b".repeat(64) },
    ] }), { workerId: "reference", expectedHead: "abc", cellIds: ["one"] })).toThrow(/unknown cell/);
    expect(() => validateWorkerEnvelope(JSON.stringify({ workerId: "reference", head: "abc", cells: [
      { id: "one", inputSha256: "a".repeat(64) },
    ] }), { workerId: "reference", expectedHead: "abc", cellIds: ["one"] })).toThrow(/valid SHA-256/);
    expect(() => validateWorkerEnvelope(JSON.stringify({ workerId: "reference", head: "abc", cells: [
      { id: "one", inputSha256: "a".repeat(64), outputSha256: "b".repeat(64) },
      { id: "one", inputSha256: "a".repeat(64), outputSha256: "b".repeat(64) },
    ] }), { workerId: "reference", expectedHead: "abc", cellIds: ["one"] })).toThrow(/duplicate cell/);
    expect(finalizeCellLedger(["one", "two"], [{ id: "one", status: "completed" }])).toEqual({
      planned: ["one", "two"], completed: ["one"], failed: [], pending: ["two"],
    });
  });

  it("maps only bare yaml, rejects subpaths and reports missing Node hook support", async () => {
    const resolutions: unknown[] = [];
    const hook = createYamlResolverHook("/tmp/provider-entry.mjs", resolutions as never);
    const url = hook.resolve("yaml", { parentURL: "file:///server/parser.mjs" }, () => { throw new Error("fallback used"); });
    expect(url.shortCircuit).toBe(true);
    expect(resolutions).toHaveLength(1);
    expect(() => hook.resolve("yaml/parser", { parentURL: "file:///server/parser.mjs" }, () => ({ url: "file:///fallback" })))
      .toThrow(/unexpected yaml subpath/);
    expect(() => assertYamlResolutions(resolutions as never, "/tmp/provider-entry.mjs")).not.toThrow();
    expect(() => assertYamlResolutions([], "/tmp/provider-entry.mjs")).toThrow(/no mapped/);
    await expect(getRegisterHooks(async () => ({} as never))).resolves.toBeNull();
  });

  it("exercises measurement phases with injected operation, clock, CPU, heap, and RSS probes", () => {
    expect(expectedPhaseCounts("cpu-wall", 3, 25)).toEqual({ warmups: 3, iterations: 25, resultCount: 25 });
    expect(expectedPhaseCounts("retained-heap", 3, 25)).toEqual({ warmups: 3, iterations: 25, resultCount: 25 });
    expect(expectedPhaseCounts("isolated-peak-rss", 3, 25)).toEqual({ warmups: 0, iterations: 1, resultCount: 1 });
    expect(expectedPhaseCounts("semantic-only", 3, 25)).toEqual({ warmups: 0, iterations: 1, resultCount: 1 });
    let operations = 0;
    const cpuSamples = [{ user: 1000, system: 500 }, { user: 6000, system: 2500 }];
    const clockSamples = [10, 14];
    const cpu = runMeasurementPhase({
      phase: "cpu-wall",
      warmups: 3,
      iterations: 2,
      operation: () => ({ ordinal: ++operations }),
      cpuUsage: () => cpuSamples.shift()!,
      now: () => clockSamples.shift()!,
      summarize: (result: { ordinal: number }) => ({ ordinal: result.ordinal }),
    });
    expect(operations).toBe(5);
    expect(cpu.cpuMs).toBe(7);
    expect(cpu.wallMs).toBe(4);
    expect(cpu.resultCount).toBe(2);

    let gcCalls = 0;
    const heapSamples = [{ heapUsed: 100 }, { heapUsed: 180 }];
    const heap = runMeasurementPhase({
      phase: "retained-heap",
      warmups: 0,
      iterations: 3,
      operation: () => ({ retained: true }),
      collectGarbage: () => { gcCalls++; },
      memoryUsage: () => heapSamples.shift()!,
      summarize: (results: unknown[]) => ({ retainedResults: results.length }),
    });
    expect(gcCalls).toBe(2);
    expect(heap.retainedHeapBytes).toBe(80);
    expect(heap.output.retainedResults).toBe(3);

    const rssSamples = [{ rss: 1200 }, { rss: 1800 }];
    const rss = runMeasurementPhase({
      phase: "isolated-peak-rss",
      operation: () => ({ parsed: true }),
      collectGarbage: () => {},
      memoryUsage: () => rssSamples.shift()!,
      resourceUsage: () => ({ maxRSS: 4 }),
      peakRssBytes: (maxRss: number) => maxRss * 1024,
      summarize: (result: { parsed: boolean }) => result,
    });
    expect(rss.resultCount).toBe(1);
    expect(rss.beforeRssBytes).toBe(1200);
    expect(rss.afterRssBytes).toBe(1800);
    expect(rss.processMaxRssBytes).toBe(4096);

    const envelope = { workerId: "w", observationId: "c:repeat:1:ref:cpu-wall", repeatIndex: 1, head: "h", cellId: "c", participant: "ref", phase: "cpu-wall", inputSha256: "a".repeat(64), outputSha256: "b".repeat(64), warmups: 3, iterations: 2, resultCount: 2 };
    expect(validatePhaseResult(envelope, { ...envelope }).resultCount).toBe(2);
    expect(() => validatePhaseResult({ ...envelope, resultCount: 1 }, envelope)).toThrow(/result count/);
    expect(() => validatePhaseResult({ ...envelope, warmups: 2 }, envelope)).toThrow(/warmups count/);
    expect(() => validatePhaseResult({ ...envelope, iterations: 25 }, envelope)).toThrow(/iterations count/);
    expect(() => validatePhaseResult({ ...envelope, repeatIndex: 2 }, envelope)).toThrow(/repeat index/);
    expect(() => validatePhaseResult({ ...envelope, observationId: "wrong" }, envelope)).toThrow(/observationId/);
  });

  it("hashes worker-read bytes and gates eligible pairs on public semantic parity", () => {
    const actual = Buffer.from("expected bytes\n");
    const expectedHash = "a".repeat(64);
    expect(() => verifyInputBytes(Buffer.from("stale bytes\n"), expectedHash)).toThrow(/source input checksum mismatch/);
    const actualHash = createHash("sha256").update(actual).digest("hex");
    const observed = verifyInputBytes(actual, actualHash);
    expect(observed.source).toBe("expected bytes\n");
    expect(observed.inputSha256).toBe(actualHash);

    const shared = { value: 1 };
    const aliasSnapshot = snapshotPublicValue({ left: shared, right: shared });
    const duplicatedSnapshot = snapshotPublicValue({ left: { value: 1 }, right: { value: 1 } });
    expect(aliasSnapshot).not.toEqual(duplicatedSnapshot);

    const candidate = {
      sourceSha256: "candidate-input-hash",
      tokenCount: 11,
      documents: [{ range: [0, 1, 2], diagnostics: [], value: aliasSnapshot, conversionError: null }],
      lineStarts: [0, 4],
    };
    const reference = {
      sourceSha256: "reference-input-hash",
      tokenCount: 99,
      documents: [{ range: [0, 1, 2], diagnostics: [], value: aliasSnapshot, conversionError: null }],
      lineStarts: [0, 4],
    };
    expect(semanticOutcomesEqual(candidate, reference)).toBe(true);
    expect(evaluateSemanticPair("uniqueKeys-false", candidate, reference)).toMatchObject({ semanticAgreement: true, performanceEligible: true });
    expect(semanticOutcomesEqual(candidate, { ...reference, lineStarts: [0, 5] })).toBe(false);
    expect(semanticOutcomesEqual(candidate, { ...reference, documents: [{ ...reference.documents[0]!, value: { type: "string", value: "1" } }] })).toBe(false);
    expect(semanticOutcomesEqual(candidate, { ...reference, documents: [{ ...reference.documents[0]!, diagnostics: [{ code: "BAD_INDENT", pos: [4, 5] }] }] })).toBe(false);
    const mismatch = evaluateSemanticPair("uniqueKeys-true", candidate, { ...reference, documents: [{ ...reference.documents[0]!, range: [0, 1, 3] }] });
    expect(mismatch).toMatchObject({ semanticAgreement: false, performanceEligible: false, reason: "candidate/reference semantic preflight differs" });
    expect(isMatchedPolicySemanticMismatch("uniqueKeys-true", mismatch)).toBe(true);
    const defaultPair = evaluateSemanticPair("literal-default", candidate, reference);
    expect(defaultPair).toMatchObject({ semanticAgreement: true, performanceEligible: false });
    expect(isMatchedPolicySemanticMismatch("literal-default", { semanticAgreement: false })).toBe(false);
  });

  it("charges provider and semantic preparation against the outer campaign deadline", () => {
    let clock = 0;
    const budget = createCampaignBudget({
      startedAt: 0,
      now: () => clock,
      outerBudgetMs: 60_000,
    });
    clock = 12_000; // participant loading and preflight consumed twelve seconds
    expect(budget.remainingOuterMs()).toBe(48_000);
    clock = 60_000;
    expect(budget.expired()).toBe(true);
    expect(budget.remainingOuterMs()).toBe(0);
  });

  it("censuses own data properties without invoking accessors and deduplicates cycles", () => {
    const shared: Record<string, unknown> = { value: "yaml" };
    const root: Record<string, unknown> = { left: shared, right: shared };
    root.self = root;
    let getterCalls = 0;
    Object.defineProperty(root, "unsafe", { enumerable: true, get() { getterCalls++; throw new Error("getter ran"); } });
    const census = censusOwnGraph([
      { name: "result", value: root },
      { name: "source", value: "a\n" },
    ], { classify: (value) => Array.isArray(value) ? "array" : "object", stringFields: ["value"] });
    expect(getterCalls).toBe(0);
    expect(census.uniqueReferences).toBe(2);
    expect(census.objects).toBe(2);
    expect(census.stringFieldOccurrences).toBe(2);
    expect(census.stringFieldCodeUnits).toBe(6);
  });

  it("excludes own schema links while reporting occurrences and distinct identities", () => {
    const sharedSchema = { rules: [{ tag: "shared" }] };
    const first = { schema: sharedSchema, extraReference: sharedSchema };
    const second = { schema: sharedSchema };
    const third = { schema: { rules: [{ tag: "per-document" }] } };
    const census = censusOwnGraph([
      { name: "first-document", value: first },
      { name: "second-document", value: second },
      { name: "third-document", value: third },
    ], { excludedReferenceFields: ["schema"] });
    expect(census.objects).toBe(3);
    expect(census.uniqueReferences).toBe(3);
    expect(census.excludedReferences.schema).toMatchObject({ occurrences: 3, uniqueReferences: 2,
      identities: [{ id: "excluded-0", occurrences: 2 }, { id: "excluded-1", occurrences: 1 }],
      links: [
        { ownerReferenceId: "graph-0", ownerCategory: "other", referencedIdentityId: "excluded-0" },
        { ownerReferenceId: "graph-1", ownerCategory: "other", referencedIdentityId: "excluded-0" },
        { ownerReferenceId: "graph-2", ownerCategory: "other", referencedIdentityId: "excluded-1" },
      ] });
  });

  it("keeps diagnostic requests inside their predeclared provider, policy, and fixture scope", () => {
    const gha = "github-actions-cmake-multi-platform";
    expect(validateDiagnosticRequest({ diagnostic: "cpu-profile", participant: "candidate", fixture: gha, artifact: "/private/candidate.cpuprofile" }))
      .toEqual({ serverMode: false, policy: "uniqueKeys-false", provider: "candidate" });
    expect(validateDiagnosticRequest({ diagnostic: "heap-snapshot", participant: "server-reference", fixture: gha, artifact: "/private/reference.heapsnapshot" }))
      .toEqual({ serverMode: true, policy: "literal-default", provider: "reference" });
    expect(() => validateDiagnosticRequest({ diagnostic: "cpu-profile", participant: "candidate", fixture: gha, policy: "uniqueKeys-true", artifact: "x" }))
      .toThrow(/predeclared/);
    expect(() => validateDiagnosticRequest({ diagnostic: "heap-snapshot", participant: "candidate", fixture: gha, artifact: "x" }))
      .toThrow(/actual-server/);
    expect(() => validateDiagnosticRequest({ diagnostic: "graph-census", participant: "server-candidate", fixture: "unknown" }))
      .toThrow(/original corpus/);
    expect(() => validateDiagnosticRequest({ diagnostic: "graph-census", participant: "candidate", fixture: gha }))
      .toThrow(/actual-server/);
    expect(() => validateDiagnosticRequest({ diagnostic: "graph-census", participant: "server-candidate", fixture: gha, artifact: "unused" }))
      .toThrow(/does not create/);
  });

  it("canonicalizes artifact parents before checking repository containment", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "lsp-artifact-parent-"));
    const repository = resolve(directory, "repository");
    const outside = resolve(directory, "outside");
    const linkedParent = resolve(outside, "linked-parent");
    mkdirSync(repository);
    mkdirSync(outside);
    symlinkSync(repository, linkedParent, "dir");
    try {
      expect(() => canonicalFreshArtifactPath(resolve(linkedParent, "cpu.cpuprofile"), repository))
        .toThrow(/outside the repository/);
      expect(canonicalFreshArtifactPath(resolve(outside, "cpu.cpuprofile"), repository))
        .toBe(resolve(outside, "cpu.cpuprofile"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("clamps the diagnostic inner worker budget to the CLI outer deadline", () => {
    let noPrepClock = 0;
    const noPrepBudget = createDiagnosticBudget({ startedAt: 0, now: () => noPrepClock });
    noPrepBudget.startInner();
    noPrepClock = 49_000;
    expect(noPrepBudget.remainingOuterMs()).toBe(11_000);
    expect(noPrepBudget.remainingWorkerMs()).toBe(0);

    let clock = 0;
    const budget = createDiagnosticBudget({ startedAt: 0, now: () => clock });
    clock = 15_000;
    budget.startInner();
    expect(budget.remainingWorkerMs()).toBe(45_000);
    clock = 44_000;
    expect(budget.remainingWorkerMs()).toBe(16_000);
    clock = 60_000;
    expect(budget.expired()).toBe(true);
    expect(budget.remainingWorkerMs()).toBe(0);
  });

  it("does not accept a low-coverage profile just because it contains 300 samples", () => {
    const profile = classifyCpuSamples({
      nodes: [{ id: 1, callFrame: { functionName: "anonymous", url: "" } }],
      samples: Array(300).fill(1),
    });
    expect(profile).toMatchObject({ sampleCount: 300, assignedSamples: 0, usefulSamples: 0, classifiedCoverage: 0,
      attributionAssessment: "insufficient-samples-or-coverage-for-fine-attribution" });
  });

  it("rejects diagnostic worker identity, provenance, and resolver target drift", () => {
    const expected = {
      kind: "lsp-diagnostic", workerId: "graph-census:server-candidate:fixture", diagnostic: "graph-census",
      head: "candidate-head", participant: "server-candidate", fixture: "fixture", policy: "literal-default",
      inputSha256: "a".repeat(64), serverMode: true, entry: "/providers/candidate/yaml-compat.js", serverRoot: "/server",
      provider: { root: "/providers/candidate", name: "lightning-yaml", version: "0.1.1", packageJsonSha256: "b".repeat(64),
        lockSha256: null, entryPath: "/providers/candidate/yaml-compat.js", entryBytes: 123, entrySha256: "c".repeat(64), closureCount: 3, closureSha256: "d".repeat(64) },
    };
    const valid = {
      kind: "lsp-diagnostic", status: "completed", scoredMeasurement: false,
      workerId: expected.workerId, diagnostic: expected.diagnostic, head: expected.head, participant: expected.participant,
      fixture: expected.fixture, policy: expected.policy, inputSha256: expected.inputSha256,
      provenance: { root: expected.provider.root, name: expected.provider.name, version: expected.provider.version,
        packageJsonSha256: expected.provider.packageJsonSha256,
        entry: { path: expected.provider.entryPath, bytes: expected.provider.entryBytes, sha256: expected.provider.entrySha256 },
        closure: { count: expected.provider.closureCount, sha256: expected.provider.closureSha256 } },
      diagnosticResult: { diagnostic: expected.diagnostic },
      resolutions: [{ specifier: "yaml", target: "file:///providers/candidate/yaml-compat.js", parentURL: "file:///server/out/parser.js" }],
    };
    expect(validateDiagnosticWorker(valid, expected)).toMatchObject({ resolutionCount: 1, targetsValidated: true, parentRootsValidated: true });
    for (const key of ["kind", "workerId", "diagnostic", "head", "participant", "fixture", "policy", "inputSha256"]) {
      expect(() => validateDiagnosticWorker({ ...valid, [key]: "wrong" }, expected)).toThrow(new RegExp(key));
    }
    expect(() => validateDiagnosticWorker({ ...valid, provenance: { ...valid.provenance, entry: { sha256: "f".repeat(64) } } }, expected)).toThrow(/provenance/);
    expect(() => validateDiagnosticWorker({ ...valid, provenance: { ...valid.provenance, entry: { ...valid.provenance.entry, path: "/providers/other.js" } } }, expected)).toThrow(/provenance/);
    expect(() => validateDiagnosticWorker({ ...valid, resolutions: [{ ...valid.resolutions[0], target: "file:///other/yaml.js" }] }, expected)).toThrow(/target/);
    expect(() => validateDiagnosticWorker({ ...valid, resolutions: [{ ...valid.resolutions[0], parentURL: "file:///outside/parser.js" }] }, expected)).toThrow(/parent escaped/);
    const incompleteExpected = { ...expected, diagnostic: "heap-snapshot" };
    const incomplete = { ...valid, status: "incomplete", diagnostic: "heap-snapshot",
      diagnosticResult: { diagnostic: "heap-snapshot", status: "incomplete", cleanupStatus: "unknown" } };
    expect(validateDiagnosticWorker(incomplete, incompleteExpected).targetsValidated).toBe(true);
    expect(validateDiagnosticWorker({ ...incomplete, diagnosticResult: { ...incomplete.diagnosticResult, cleanupStatus: "retained" } }, incompleteExpected).targetsValidated).toBe(true);
    expect(() => validateDiagnosticWorker({ ...incomplete, diagnosticResult: { diagnostic: "heap-snapshot", status: "incomplete" } }, incompleteExpected))
      .toThrow(/cleanup status/);
  });

  it("redacts nested provider paths while keeping safe entry identity fields", () => {
    const entrySha256 = "a".repeat(64);
    const result = redactPrivatePaths({
      reference: { entryPath: "/private/install/node_modules/yaml/index.js", entryBasename: "index.js", entrySha256 },
      nested: ["file:///private/server/parser.js", "relative/name.js"],
    });
    expect(result).toEqual({
      reference: { entryPath: "<private-path>", entryBasename: "index.js", entrySha256 },
      nested: ["<private-path>", "relative/name.js"],
    });
    expect(JSON.stringify(result)).not.toMatch(/\/private\/|file:\/\//);
  });

  it("runs the fixed CPU-profile loop through an injected inspector session", async () => {
    const calls: string[] = [];
    const session = {
      post(method: string, _params: unknown, callback: (error: Error | null, result?: unknown) => void) {
        calls.push(method);
        queueMicrotask(() => callback(null, method === "Profiler.stop" ? { profile: { samples: [1, 2, 3] } } : {}));
      },
    };
    let operations = 0;
    const result = await collectCpuProfile({
      session: session as never,
      operation: () => { operations++; },
    });
    expect(operations).toBe(253);
    expect(result).toMatchObject({ warmups: 3, iterations: 250, sampleIntervalUs: 1000, profile: { samples: [1, 2, 3] } });
    expect(calls).toEqual(["Profiler.enable", "Profiler.setSamplingInterval", "Profiler.start", "Profiler.stop", "Profiler.disable"]);
    expect(classifyCpuSamples({
      nodes: [
        { id: 1, callFrame: { functionName: "root", url: "" }, children: [2, 3, 4] },
        { id: 2, callFrame: { functionName: "parseDocument", url: "file:///parser.mjs" } },
        { id: 3, callFrame: { functionName: "parse", url: "file:///server/yamlParser07.js" } },
        { id: 4, callFrame: { functionName: "convertAST", url: "file:///server/ast-converter.js" } },
      ],
      samples: [2, 1, 3, 4],
    })).toEqual({ sampleCount: 4, assignedSamples: 3, usefulSamples: 2, classifiedCoverage: 0.75,
      categories: { lexerParser: 1, composition: 0, customCallbacks: 0, runtimeGc: 0, serverAst: 1, serverWrapper: 1, unassigned: 1 },
      attributionAssessment: "insufficient-samples-or-coverage-for-fine-attribution" });
    const adequate = classifyCpuSamples({
      nodes: [
        { id: 1, callFrame: { functionName: "convertAST", url: "file:///server/ast-converter.js" } },
        { id: 2, callFrame: { functionName: "anonymous", url: "" } },
      ],
      samples: [...Array(200).fill(1), ...Array(50).fill(2)],
    });
    expect(adequate).toMatchObject({ sampleCount: 250, assignedSamples: 200, usefulSamples: 200, classifiedCoverage: 0.8,
      attributionAssessment: "sample-count-and-coverage-threshold-met" });
  });

  it("streams an injected heap snapshot without interpreting it", async () => {
    const directory = mkdtempSync(`${tmpdir()}/lsp-snapshot-test-`);
    const file = resolve(directory, "sample.heapsnapshot");
    const events = new Map<string, (event: { params: { chunk: string } }) => void>();
    const session = {
      on(name: string, listener: (event: { params: { chunk: string } }) => void) { events.set(name, listener); },
      post(method: string, _params: unknown, callback: (error: Error | null, result?: unknown) => void) {
        if (method === "HeapProfiler.takeHeapSnapshot") {
          events.get("HeapProfiler.addHeapSnapshotChunk")?.({ params: { chunk: "{\"snapshot\":" } });
          events.get("HeapProfiler.addHeapSnapshotChunk")?.({ params: { chunk: "true}" } });
        }
        queueMicrotask(() => callback(null, {}));
      },
    };
    try {
      await expect(writeHeapSnapshot(file, { session: session as never })).resolves.toEqual({ bytes: 17, chunks: 2 });
      expect(readFileSync(file, "utf8")).toBe("{\"snapshot\":true}");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports slow and failing snapshot sinks as incomplete and removes partial artifacts", async () => {
    const run = async (sink: { write(chunk: string): boolean | void; close(): void; abort(): void }) => {
      const listeners = new Map<string, (event: { params: { chunk: string } }) => void>();
      const session = {
        on(name: string, listener: (event: { params: { chunk: string } }) => void) { listeners.set(name, listener); },
        post(method: string, _params: unknown, callback: (error: Error | null, result?: unknown) => void) {
          if (method === "HeapProfiler.takeHeapSnapshot") {
            listeners.get("HeapProfiler.addHeapSnapshotChunk")?.({ params: { chunk: "chunk-one" } });
            listeners.get("HeapProfiler.addHeapSnapshotChunk")?.({ params: { chunk: "chunk-two" } });
          }
          queueMicrotask(() => callback(null, {}));
        },
      };
      const error = await writeHeapSnapshot("/tmp/not-created.heapsnapshot", { session: session as never, createSink: () => sink })
        .then(() => null, (failure: Error & { artifactState?: unknown }) => failure);
      return error;
    };
    let slowWrites = 0;
    let slowAborts = 0;
    const slow = await run({ write() { slowWrites++; return false; }, close() {}, abort() { slowAborts++; } });
    expect(slow?.artifactState).toEqual({ status: "incomplete", bytesWritten: 0, chunksReceived: 2, cleanupStatus: "unknown" });
    expect(slowWrites).toBe(1);
    expect(slowAborts).toBe(1);

    let errorAborts = 0;
    const failed = await run({ write() { throw new Error("disk failure"); }, close() {}, abort() { errorAborts++; } });
    expect(failed?.artifactState).toEqual({ status: "incomplete", bytesWritten: 0, chunksReceived: 2, cleanupStatus: "unknown" });
    expect(errorAborts).toBe(1);
  });

  it("reports retained partial snapshots when unlink fails", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "lsp-unlink-failure-"));
    const file = resolve(directory, "snapshot.heapsnapshot");
    const listeners = new Map<string, (event: { params: { chunk: string } }) => void>();
    const session = {
      on(name: string, listener: (event: { params: { chunk: string } }) => void) { listeners.set(name, listener); },
      post(method: string, _params: unknown, callback: (error: Error | null, result?: unknown) => void) {
        if (method === "HeapProfiler.takeHeapSnapshot") {
          listeners.get("HeapProfiler.addHeapSnapshotChunk")?.({ params: { chunk: "snapshot chunk" } });
        }
        queueMicrotask(() => callback(null, {}));
      },
    };
    try {
      const failure = await writeHeapSnapshot(file, {
        session: session as never,
        createSink: (path) => createFileSink(path, {
          unlink(target) {
            if (target.endsWith(".partial")) throw new Error("injected unlink failure");
            unlinkSync(target);
          },
        }),
      }).then(() => null, (error: Error & { artifactState?: unknown }) => error);
      expect(failure?.artifactState).toEqual({
        status: "incomplete", bytesWritten: "snapshot chunk".length,
        chunksReceived: 1, cleanupStatus: "retained",
      });
      expect(readdirSync(directory).some((name) => name.endsWith(".partial"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
