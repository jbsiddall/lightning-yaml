import { describe, expect, it } from "vitest";
import fc from "fast-check";
import * as jsYamlReference from "js-yaml";
import * as yamlReference from "yaml";
import { load as candidateLoad, loadAll as candidateLoadAll, dump as candidateDump } from "../../../src/js-yaml-compat.ts";
import { parse as candidateParse, parseAllDocuments as candidateParseAllDocuments, stringify as candidateStringify } from "../../../src/yaml-compat.ts";
import { parse as nativeParse, parseAll as nativeParseAll, stringify as nativeStringify } from "../../../src/core.ts";
import { compareGraph } from "./graph.js";
import { loadRealWorldCorpus } from "./realWorldCorpus.js";

const corpusPromise = loadRealWorldCorpus();

async function checkFixture(id: string, seed: number): Promise<void> {
  const input = (await corpusPromise).find((entry) => entry.id === id);
  if (!input) throw new Error(`real-world fixture missing from manifest: ${id}`);
  expect(input.text).toContain("\n");
  expect(input.text).not.toContain("\r\n");

  const jsBaseline = jsYamlReference.load(input.text);
  const jsStreamBaseline: unknown[] = [];
  jsYamlReference.loadAll(input.text, (value) => jsStreamBaseline.push(value));
  const yamlBaseline = yamlReference.parse(input.text);
  const yamlStreamBaseline = yamlReference.parseAllDocuments(input.text).map((doc) => doc.toJS());

  const candidateJsBaseline = candidateLoad(input.text);
  const candidateJsStreamBaseline: unknown[] = [];
  candidateLoadAll(input.text, (value) => candidateJsStreamBaseline.push(value));
  expect(compareGraph(jsBaseline, candidateJsBaseline).equal).toBe(true);
  expect(compareGraph(jsStreamBaseline, candidateJsStreamBaseline).equal).toBe(true);
  expect(compareGraph(yamlBaseline, candidateParse(input.text)).equal).toBe(true);
  expect(compareGraph(yamlStreamBaseline, candidateParseAllDocuments(input.text).map((doc) => doc.toJS())).equal).toBe(true);
  expect(compareGraph(yamlBaseline, nativeParse(input.text)).equal).toBe(true);

  expect(compareGraph(nativeParse(input.text), yamlBaseline).equal).toBe(true);
  expect(compareGraph(nativeParseAll(input.text), yamlStreamBaseline).equal).toBe(true);

  const jsYamlSerialized = candidateDump(jsBaseline);
  const jsYamlRoundTrip = jsYamlReference.load(jsYamlSerialized);
  expect(compareGraph(jsBaseline, jsYamlRoundTrip).equal).toBe(true);
  const yamlSerialized = candidateStringify(yamlBaseline);
  const yamlRoundTrip = yamlReference.parse(yamlSerialized);
  expect(compareGraph(yamlBaseline, yamlRoundTrip).equal).toBe(true);
  const nativeSerialized = nativeStringify(yamlBaseline);
  expect(compareGraph(yamlBaseline, yamlReference.parse(nativeSerialized)).equal).toBe(true);

  const eolVariant = fc.boolean().map((toCrlf) =>
    toCrlf ? input.text.replace(/\n/g, "\r\n") : input.text,
  );
  fc.assert(fc.property(eolVariant, (text) => {
    const jsValue = jsYamlReference.load(text);
    const jsStream: unknown[] = [];
    jsYamlReference.loadAll(text, (value) => jsStream.push(value));
    expect(compareGraph(jsBaseline, jsValue).equal).toBe(true);
    expect(compareGraph(jsStreamBaseline, jsStream).equal).toBe(true);
    expect(compareGraph(jsValue, candidateLoad(text)).equal).toBe(true);
    const candidateJsStream: unknown[] = [];
    candidateLoadAll(text, (value) => candidateJsStream.push(value));
    expect(compareGraph(jsStream, candidateJsStream).equal).toBe(true);

    const yamlValue = yamlReference.parse(text);
    const yamlStream = yamlReference.parseAllDocuments(text).map((doc) => doc.toJS());
    expect(compareGraph(yamlBaseline, yamlValue).equal).toBe(true);
    expect(compareGraph(yamlStreamBaseline, yamlStream).equal).toBe(true);
    expect(compareGraph(yamlValue, candidateParse(text)).equal).toBe(true);
    expect(compareGraph(yamlStream, candidateParseAllDocuments(text).map((doc) => doc.toJS())).equal).toBe(true);
    expect(compareGraph(yamlStream, nativeParseAll(text)).equal).toBe(true);

    for (const [value, serialize, parseReference] of [
      [jsValue, candidateDump, jsYamlReference.load],
      [yamlValue, candidateStringify, yamlReference.parse],
    ] as const) {
      const roundTrip = parseReference(serialize(value));
      expect(compareGraph(value, roundTrip).equal).toBe(true);
    }
  }), { numRuns: 16, seed });
}

describe("pinned real-world EOL properties", () => {
  it("Kubernetes Deployment: exact bytes and LF/CRLF preserve reference and candidate graphs", async () => {
    await checkFixture("kubernetes-nginx-deployment", 20261016);
  });
  it("Docker Compose: exact bytes and LF/CRLF preserve reference and candidate graphs", async () => {
    await checkFixture("docker-compose-nginx-flask-mysql", 20261017);
  });
  it("GitHub Actions: exact bytes and LF/CRLF preserve reference and candidate graphs", async () => {
    await checkFixture("github-actions-node-ci", 20261018);
  });
});
