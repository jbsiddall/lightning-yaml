import { test } from "vitest";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { Worker } from "node:worker_threads";
import fc from "fast-check";
import * as reference from "yaml";
import * as compat from "../../../src/yaml-compat.ts";
import type { CSTSourceToken, CSTToken } from "../../../src/yaml-compat.ts";

const textArb = fc.array(
  fc.constantFrom("a", "Z", " ", "\"", "\\", "😀", "雪", "é", "λ", "\n", "\t"),
  { maxLength: 12 },
).map((chars) => chars.join(""));
const scalarArb = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  textArb,
);
const shallowObjectArb = fc.dictionary(
  fc.constantFrom("a", "items", "nested", "é"),
  fc.oneof(scalarArb, fc.array(scalarArb, { maxLength: 3 })),
  { maxKeys: 3 },
);
const jsonValueArb = fc.oneof(
  scalarArb,
  fc.array(scalarArb, { maxLength: 4 }),
  shallowObjectArb,
  fc.array(shallowObjectArb, { maxLength: 3 }),
);
const sourceScenarioArb = fc.record({
  value: jsonValueArb,
  quoted: textArb,
  wrapper: fc.constantFrom("flow" as const, "block" as const),
  eol: fc.constantFrom("\n", "\r\n"),
  bom: fc.boolean(),
  comments: fc.boolean(),
  cuts: fc.uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 3 }),
});

function renderSourceScenario(scenario: {
  value: unknown;
  quoted: string;
  wrapper: "flow" | "block";
  eol: string;
  bom: boolean;
  comments: boolean;
}): string {
  const { value, quoted, wrapper, eol } = scenario;
  const prefix = `${scenario.bom ? "\ufeff" : ""}${scenario.comments ? `# leading 😀${eol}` : ""}---${eol}`;
  const payload = wrapper === "flow"
    ? `{payload: [${JSON.stringify(value)}], quoted: ${JSON.stringify(quoted)}}`
    : `payload: ${JSON.stringify(value)}${eol}quoted: ${JSON.stringify(quoted)}`;
  const suffix = `...${eol}${scenario.comments ? `# trailing${eol}` : ""}`;
  return `${prefix}${payload}${eol}${suffix}`;
}

function parseChunks(source: string, cuts: number[]): CSTToken[] {
  const parser = new compat.Parser();
  const boundaries = [0, ...cuts, source.length];
  const tokens: CSTToken[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    tokens.push(...parser.parse(source.slice(start, end), index < boundaries.length - 2));
  }
  return tokens;
}

test("yaml shim exposes the complete source lexer and parser constructors", () => {
  strictEqual(typeof compat.Lexer, "function");
  strictEqual(typeof compat.Parser, "function");
  strictEqual((compat.default as Record<string, unknown>).Lexer, compat.Lexer);
  strictEqual((compat.default as Record<string, unknown>).Parser, compat.Parser);
  strictEqual("CST" in compat.default, false);
  strictEqual("Composer" in compat, false);
});

test("public parser preserves nested source tokens, trivia, and absolute offsets", () => {
  const source = "a: |+\n  hi\n\n#tail\n";
  const parser = new compat.Parser();
  const tokens = [...parser.parse(source)];
  deepStrictEqual(tokens, [...new reference.Parser().parse(source)]);
  const doc = tokens.find((token) => token.type === "document");
  ok(doc);
  const map = doc.value;
  ok(map && map.type === "block-map");
  const scalar = map.items[0]?.value;
  ok(scalar && scalar.type === "block-scalar");
  strictEqual(scalar.offset, 3);
  strictEqual(scalar.source, "  hi\n\n");
  deepStrictEqual(scalar.props.map((token) => "source" in token ? token.source : ""), ["|+", "\n"]);
  strictEqual(doc.end?.some((token) => token.type === "comment" && token.source === "#tail"), true);
});

test("public lexer and parser retain issue-135 stream boundaries and partial flow children", () => {
  const source = '---\nfirst: 0\n---\n["key\n value": 1]\n---\nlast: 2\n';
  const tokens = [...new compat.Parser().parse(source)];
  deepStrictEqual(tokens.filter((token) => token.type === "document").map((token) => token.offset), [0, 13, 35]);

  const partial = [...new compat.Parser().parse("a: [1, 2")];
  const doc = partial.find((token) => token.type === "document");
  ok(doc && doc.value?.type === "block-map");
  const flow = doc.value.items[0]?.value;
  ok(flow && flow.type === "flow-collection");
  strictEqual(flow.items.length, 2);
  strictEqual(flow.end.length, 0);
});

test("lexer emits upstream lexemes and parser reconstructs raw syntax", () => {
  const inputs = [
    "\ufeff%YAML 1.2\n---\nplain: text\n",
    "quoted: 'a ''quote'''\nflow: {x: [1, 2]}\n",
    "tag: !<tag:example.com,2020:thing> &a value\nalias: *a\n",
    "---x\n  ---\nkey: |2-\n  body\n...\n",
    "a: \"x\\ny\" #end\r\n#between\r\n",
  ];
  for (const source of inputs) {
    const lexemes = [...new compat.Lexer().lex(source)];
    deepStrictEqual(lexemes, [...new reference.Lexer().lex(source)]);
    const tokens = [...new compat.Parser().parse(source)];
    deepStrictEqual(tokens, [...new reference.Parser().parse(source)]);
    for (const token of tokens) strictEqual(reference.CST.stringify(token), source.slice(token.offset, token.offset + reference.CST.stringify(token).length));
  }
});

test("source parser covers directives, trivia, block and flow structure, and malformed EOF", () => {
  const sources = [
    "%YAML 1.2\n%TAG !e! tag:example.com,2020:\n---\n&a {key: [one, !e!x two], ? explicit : value}\n...\n",
    "?\n: empty-key\nplain: value\nquoted: \"multi\n line\"\n",
    "literal: |+\n  one\n\nfolded: >2-\n  two\n",
    "[a, {b: 2, c: [d, e]}\n",
    "---\na: [1, 2\n---\nb: 3\n",
    "a: \"open\n---\nb: 2\n",
    "...\n---\nnull\n...\n",
  ];
  for (const source of sources) {
    const tokens = [...new compat.Parser().parse(source)];
    deepStrictEqual(tokens, [...new reference.Parser().parse(source)], source);
    strictEqual(tokens.map((token) => reference.CST.stringify(token)).join(""), source);
  }
});

test("error tokens retain unexpected source and unfinished constructs stay partial", () => {
  const source = "]\n";
  const tokens: CSTToken[] = [...new compat.Parser().parse(source)];
  deepStrictEqual(tokens, [...new reference.Parser().parse(source)]);
  const error = tokens.find((token) => token.type === "error");
  ok(error && error.type === "error");
  strictEqual(error.source, "]");
  const sourceToken: CSTSourceToken | undefined = tokens.find((token): token is CSTSourceToken => "indent" in token && "source" in token);
  strictEqual(sourceToken, undefined);

  for (const unfinished of ["a: \"open", "a: |\n", "{a: 1", "a: [1, 2"]) {
    const parsed = [...new compat.Parser().parse(unfinished)];
    deepStrictEqual(parsed, [...new reference.Parser().parse(unfinished)], unfinished);
    strictEqual(parsed.some((token) => token.type === "error"), false, unfinished);
  }
});

test("custom Lexer.next pipeline preserves offsets, stack completion, and callback timing", () => {
  const source = "a: one\nb: two\n";
  const lineOffsets: number[] = [];
  const lexer = new compat.Lexer();
  const parser = new compat.Parser((offset) => lineOffsets.push(offset));
  const tokens = [...lexer.lex(source)].flatMap((lexeme) => [...parser.next(lexeme)]);
  tokens.push(...parser.end());
  deepStrictEqual(tokens, [...new reference.Parser().parse(source)]);
  deepStrictEqual(lineOffsets, [7, 14]);
  strictEqual(parser.offset, source.length);
  strictEqual(parser.stack.length, 0);
});

test("LOG_TOKENS stays quiet by default and remains dynamically enabled in Node", () => {
  const prior = process.env.LOG_TOKENS;
  const priorLog = console.log;
  const lines: unknown[][] = [];
  try {
    delete process.env.LOG_TOKENS;
    console.log = (...args: unknown[]) => { lines.push(args); };
    [...new compat.Parser().parse("a: 1\n")];
    strictEqual(lines.length, 0);
    process.env.LOG_TOKENS = "1";
    [...new compat.Parser().parse("a: 1\n")];
    ok(lines.length > 0);
    strictEqual(lines[0]?.[0], "|");
    ok(typeof lines[0]?.[1] === "string" && lines[0][1].length > 0);
  } finally {
    console.log = priorLog;
    if (prior === undefined) delete process.env.LOG_TOKENS;
    else process.env.LOG_TOKENS = prior;
  }
});

test("reference Composer consumes public parser tokens and retains their identity", () => {
  const source = "---\nfirst: 0\n---\n[\"key\n value\": 1]\n---\nlast: 2\n";
  const sourceTokens = [...new compat.Parser().parse(source)];
  const docs = [...new reference.Composer({ keepSourceTokens: true }).compose(sourceTokens)];
  const expected = [...new reference.Composer({ keepSourceTokens: true }).compose([...new reference.Parser().parse(source)])];
  deepStrictEqual(docs.map((doc) => doc.range), expected.map((doc) => doc.range));
  deepStrictEqual(docs.map((doc) => doc.errors.map(({ code, message }) => ({ code, message }))), expected.map((doc) => doc.errors.map(({ code, message }) => ({ code, message }))));
  strictEqual(docs.length, 3);
  strictEqual(docs[0]?.range?.[0], 0);
  strictEqual(docs[1]?.range?.[0], 13);
  strictEqual(docs[2]?.range?.[0], 35);
  const sourceDocuments = sourceTokens.filter((token) => token.type === "document");
  for (const [index, doc] of docs.entries()) {
    strictEqual(doc.contents?.srcToken, sourceDocuments[index]?.type === "document" ? sourceDocuments[index].value : undefined);
  }
  ok(docs[1]?.contents && docs[1].contents.constructor.name === "YAMLSeq");
  strictEqual((docs[1]?.contents as unknown as { items: unknown[] }).items.length, 1);
  ok(docs[1]?.errors.some((error) => error.code === "MULTILINE_IMPLICIT_KEY"));
});

test("reference Composer recovery distinguishes incomplete flow from an open quote", () => {
  const sources = [
    "---\na: 1\n---\nb: [1, 2\n---\nc: 3\n",
    "a: \"hello\n---\nb: 2\n",
    "a: |\n  ---\n  text\n---\nb: 2\n",
  ];
  for (const source of sources) {
    const ours = [...new reference.Composer({ keepSourceTokens: true }).compose([...new compat.Parser().parse(source)])];
    const theirs = [...new reference.Composer({ keepSourceTokens: true }).compose([...new reference.Parser().parse(source)])];
    deepStrictEqual(ours.map((doc) => doc.range), theirs.map((doc) => doc.range));
    deepStrictEqual(ours.map((doc) => doc.errors.map((error) => error.code)), theirs.map((doc) => doc.errors.map((error) => error.code)));
    strictEqual(ours.length, source.startsWith("a: \"hello") ? 1 : source.startsWith("---\na: 1") ? 3 : 2);
    if (source.startsWith("---\na: 1")) {
      deepStrictEqual(ours.map((doc) => doc.range?.[0]), [0, 9, 22]);
      strictEqual([...new compat.Parser().parse(source)].some((token) => token.type === "error"), false);
    }
  }
});

test("malformed marker recovery terminates and retains tokens in a bounded worker", () => {
  const source = "---\na: 1\n---\nb: [1, 2\n---\nc: 3\n";
  const moduleUrl = new URL("../../../src/yaml-compat.ts", import.meta.url).href;
  const code = `const { parentPort } = require('node:worker_threads'); require('tsx/esm/api').register(); Promise.all([import(${JSON.stringify(moduleUrl)}), import('yaml')]).then(([compat, yaml]) => { const tokens = [...new compat.Parser().parse(${JSON.stringify(source)})]; const docs = tokens.filter(token => token.type === 'document'); parentPort.postMessage({ offsets: docs.map(token => token.offset), itemCount: docs[1]?.value?.items?.[0]?.value?.items?.length, reconstructed: tokens.map(token => yaml.CST.stringify(token)).join('') }); }).catch(error => { throw error; });`;
  const worker = new Worker(code, { eval: true, execArgv: ["--import", "tsx"] });
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("source parser exceeded 4 second termination guard"));
    }, 4000);
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("message", async (result: { offsets: number[]; itemCount: number; reconstructed: string }) => {
      clearTimeout(timeout);
      await worker.terminate();
      try {
        deepStrictEqual(result.offsets, [0, 9, 22]);
        strictEqual(result.itemCount, 2);
        strictEqual(result.reconstructed, source);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test("public parser matches reference on every chunk split of representative inputs", () => {
  for (const source of ["a: hello\n", "x: \"a\\nb\" # c\n", "a: [1, {b: 2}]\n", "a: |2-\n  hi\n", "\ufeffa: 😀\r\nb: 2\r\n"]) {
    const expected = [...new reference.Parser().parse(source)];
    for (let split = 0; split <= source.length; split++) {
      const parser = new compat.Parser();
      const actual = [
        ...parser.parse(source.slice(0, split), true),
        ...parser.parse(source.slice(split), false),
      ];
      deepStrictEqual(actual, expected, `${JSON.stringify(source)} @ ${split}`);
    }
    const triples = [
      [1, Math.min(3, source.length - 1)],
      [source.indexOf("\n"), source.indexOf("\n") + 1],
    ];
    for (const [first, second] of triples) {
      if (first <= 0 || second <= first || second >= source.length) continue;
      const parser = new compat.Parser();
      const chunks = [source.slice(0, first), source.slice(first, second), source.slice(second)];
      const actual = chunks.flatMap((chunk, index) => [...parser.parse(chunk, index < chunks.length - 1)]);
      deepStrictEqual(actual, expected, `${JSON.stringify(source)} @ ${first},${second}`);
    }
  }
});

test("incremental Lexer plus custom Parser.next handles each split of CRLF, escapes, and markers", () => {
  const source = "\ufeffa: \"x\\ny\"\r\n---\nb: |2-\n  astral 😀\n...\n";
  for (let split = 0; split <= source.length; split++) {
    const referenceLexer = new reference.Lexer();
    const referenceParser = new reference.Parser();
    const expected: unknown[] = [];
    for (const lexeme of referenceLexer.lex(source.slice(0, split), true)) expected.push(...referenceParser.next(lexeme));
    for (const lexeme of referenceLexer.lex(source.slice(split), false)) expected.push(...referenceParser.next(lexeme));
    expected.push(...referenceParser.end());
    const lexer = new compat.Lexer();
    const parser = new compat.Parser();
    const tokens: unknown[] = [];
    for (const lexeme of lexer.lex(source.slice(0, split), true)) tokens.push(...parser.next(lexeme));
    for (const lexeme of lexer.lex(source.slice(split), false)) tokens.push(...parser.next(lexeme));
    tokens.push(...parser.end());
    deepStrictEqual(tokens, expected, `split ${split}`);
  }
});

test("fast-check renders bounded JSON-compatible YAML and compares tokens plus generated chunks", () => {
  fc.assert(
    fc.property(sourceScenarioArb, (scenario) => {
      const source = renderSourceScenario(scenario);
      const referenceLexemes = [...new reference.Lexer().lex(source)];
      const lexemes = [...new compat.Lexer().lex(source)];
      deepStrictEqual(lexemes, referenceLexemes);

      const expected = [...new reference.Parser().parse(source)];
      const tokens = [...new compat.Parser().parse(source)];
      deepStrictEqual(tokens, expected);
      strictEqual(tokens.map((token) => reference.CST.stringify(token)).join(""), source);

      const cuts = [...new Set(scenario.cuts
        .map((percent) => Math.max(1, Math.min(source.length - 1, Math.floor(source.length * percent / 100)))))]
        .sort((left, right) => left - right);
      deepStrictEqual(parseChunks(source, cuts), tokens);
    }),
    { numRuns: 300, seed: 20261020 },
  );
});

test("parse path reports initial and CRLF newline offsets", () => {
  const offsets: number[] = [];
  [...new compat.Parser((offset) => offsets.push(offset)).parse("\ufeffa: 😀\r\nb: 2\r\n")];
  deepStrictEqual(offsets, [0, 8, 14]);
});
