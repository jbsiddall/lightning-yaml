import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
    expect(enumerateCells("lsp-consumer")).toHaveLength(24);
  });

  it("asserts the direct parser/composer operation and independent UTF-16 source witness", () => {
    assertYamlProvider(yaml, "stock yaml");
    const source = semanticSources.crlfEmoji;
    const result = runBareOperation(yaml, source, { captureLineCallbacks: true });
    expect(result.documents).toHaveLength(1);
    expect(result.callbacks).toEqual(result.lineCounter.lineStarts);
    expect(assertCstLossless(yaml, result.tokens, source).utf16Length).toBe(source.length);
    expect(() => assertCstLossless(yaml, result.tokens, `${source}x`)).toThrow(/lost or changed/);
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
});
