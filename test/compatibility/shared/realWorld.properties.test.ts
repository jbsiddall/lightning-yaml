import { describe, expect, it } from "vitest";
import * as jsYamlReference from "js-yaml";
import * as yamlReference from "yaml";
import { load as candidateLoad, loadAll as candidateLoadAll, dump as candidateDump } from "../../../src/js-yaml-compat.ts";
import { parse as candidateParse, parseAllDocuments as candidateParseAllDocuments, parseDocument as candidateParseDocument, stringify as candidateStringify, Lexer as candidateLexer, Parser as candidateParser, CST as candidateCST } from "../../../src/yaml-compat.ts";
import { parse as nativeParse, parseAll as nativeParseAll, stringify as nativeStringify } from "../../../src/core.ts";
import { compareGraph } from "./graph.js";
import { loadRealWorldCorpus } from "./realWorldCorpus.js";

const realWorldInputs = await loadRealWorldCorpus();

function assertSingleDocumentBehavior(text: string, documents: unknown[]): void {
  if (documents.length > 1) {
    expect(() => nativeParse(text)).toThrow();
    expect(() => jsYamlReference.load(text)).toThrow();
    expect(() => candidateLoad(text)).toThrow();
    expect(() => yamlReference.parse(text)).toThrow();
    expect(() => candidateParse(text)).toThrow();
    return;
  }
  expect(compareGraph(documents[0], nativeParse(text)).equal).toBe(true);
  expect(compareGraph(documents[0], jsYamlReference.load(text)).equal).toBe(true);
  expect(compareGraph(documents[0], candidateLoad(text)).equal).toBe(true);
  expect(compareGraph(documents[0], yamlReference.parse(text)).equal).toBe(true);
  expect(compareGraph(documents[0], candidateParse(text)).equal).toBe(true);
}

async function checkFixture(id: string): Promise<void> {
  const input = realWorldInputs.find((entry) => entry.id === id);
  if (!input) throw new Error(`real-world fixture missing from manifest: ${id}`);
  expect(input.text).toContain("\n");
  expect(input.text).not.toContain("\r\n");
  const variants = [input.text, input.text.replace(/\n/g, "\r\n")];

  for (const text of variants) {
    const jsReferenceStream: unknown[] = [];
    const jsCandidateStream: unknown[] = [];
    jsYamlReference.loadAll(text, (value) => jsReferenceStream.push(value));
    candidateLoadAll(text, (value) => jsCandidateStream.push(value));
    assertSingleDocumentBehavior(text, jsReferenceStream);
    expect(compareGraph(jsReferenceStream, jsCandidateStream).equal).toBe(true);

    const yamlReferenceDocuments = yamlReference.parseAllDocuments(text);
    const yamlCandidateDocuments = candidateParseAllDocuments(text);
    const yamlReferenceStream = yamlReferenceDocuments.map((document) => document.toJS());
    const yamlCandidateStream = yamlCandidateDocuments.map((document) => document.toJS());
    expect(compareGraph(yamlReferenceStream, yamlCandidateStream).equal).toBe(true);
    expect(compareGraph(yamlReferenceStream, nativeParseAll(text)).equal).toBe(true);
    expect(yamlReferenceStream).toHaveLength(yamlReferenceDocuments.length);

    const referenceErrorDocument = yamlReference.parseDocument(text);
    const candidateErrorDocument = candidateParseDocument(text);
    if (jsReferenceStream.length > 1) {
      expect(referenceErrorDocument.errors.length).toBeGreaterThan(0);
      expect(candidateErrorDocument.errors.length).toBeGreaterThan(0);
    } else {
      expect(referenceErrorDocument.errors).toHaveLength(0);
      expect(candidateErrorDocument.errors).toHaveLength(0);
    }

    const referenceLexemes = [...new yamlReference.Lexer().lex(text)];
    const candidateLexemes = [...new candidateLexer().lex(text)];
    expect(candidateLexemes).toEqual(referenceLexemes);
    const referenceTokens = [...new yamlReference.Parser().parse(text)];
    const candidateTokens = [...new candidateParser().parse(text)];
    expect(candidateTokens).toEqual(referenceTokens);
    expect(candidateTokens.map((token) => candidateCST.stringify(token)).join("")).toBe(text);
    expect(candidateTokens.map((token) => yamlReference.CST.stringify(token)).join("")).toBe(text);

    for (const documentValue of yamlReferenceStream) {
      const nativeSerialized = nativeStringify(documentValue);
      const nativeRoundTrip = yamlReference.parse(nativeSerialized);
      expect(compareGraph(documentValue, nativeRoundTrip).equal).toBe(true);

      const jsSerialized = candidateDump(documentValue);
      expect(compareGraph(documentValue, jsYamlReference.load(jsSerialized)).equal).toBe(true);

      const yamlSerialized = candidateStringify(documentValue);
      expect(compareGraph(documentValue, yamlReference.parse(yamlSerialized)).equal).toBe(true);
    }
  }
}

describe("pinned real-world properties", () => {
  for (const input of realWorldInputs) {
    it(`${input.id}: exact bytes and deterministic LF/CRLF`, async () => {
      await checkFixture(input.id);
    });
  }
});
