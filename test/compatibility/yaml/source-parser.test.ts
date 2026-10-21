import { test } from "vitest";
import { deepStrictEqual, strictEqual, ok, throws } from "node:assert";
import { Worker } from "node:worker_threads";
import fc from "fast-check";
import * as reference from "yaml";
import * as compat from "../../../src/yaml-compat.ts";
import { binary } from "../../../src/source/schema/yaml-1.1/binary.ts";
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

type ParserConstructor = new (onNewLine?: (offset: number) => void) => {
  parse(source: string, incomplete?: boolean): Iterable<CSTToken>;
};

function parseChunks(source: string, cuts: number[], Parser: ParserConstructor = compat.Parser): CSTToken[] {
  const parser = new Parser();
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
  strictEqual(typeof compat.Composer, "function");
  strictEqual(typeof compat.Document, "function");
  strictEqual((compat.default as Record<string, unknown>).Composer, compat.Composer);
  strictEqual((compat.default as Record<string, unknown>).Document, compat.Document);
  strictEqual((compat.default as Record<string, unknown>).YAMLSeq, compat.YAMLSeq);
});

test("source document wrappers preserve partial documents across malformed streams", () => {
  const source = '---\nfirst: 0\n---\n["key\n value": 1]\n---\nlast: 2\n';
  const docs = compat.parseAllDocuments(source);
  strictEqual(docs.length, 3);
  deepStrictEqual(docs.map((doc) => doc.range), [[0, 13, 13], [13, 35, 35], [35, 47, 47]]);
  ok(docs[1]?.contents instanceof compat.YAMLSeq);
  ok(docs[1]?.errors.some((error) => error.code === "MULTILINE_IMPLICIT_KEY"));
  const seq = docs[1]!.contents as InstanceType<typeof compat.YAMLSeq>;
  ok(seq.items[0] instanceof compat.YAMLMap);
  const pair = (seq.items[0] as InstanceType<typeof compat.YAMLMap>).items[0]!;
  ok(pair instanceof compat.Pair);
  ok(pair.key instanceof compat.Scalar);
  strictEqual(pair.key.value, "key value");
  deepStrictEqual(pair.key.range, [18, 30, 30]);
  deepStrictEqual(docs[1]!.errors[0]?.pos, [18, 30]);
  strictEqual((docs[2]?.toJS() as Record<string, unknown>).last, 2);
});

test("real documents expose node APIs, conversion identity, directives and option boundaries", () => {
  const source = "base: &base {n: 1}\ncopy: *base\nself: &self [*self]\n? [1, 2]\n: seq-key\n? {x: y}\n: map-key\n";
  const doc = compat.parseDocument(source, { keepSourceTokens: true });
  const sourceTokens = [...new compat.Parser().parse(source)];
  ok(doc instanceof compat.Document);
  ok(compat.isDocument(doc));
  ok(doc.contents instanceof compat.YAMLMap);
  const root = doc.contents as InstanceType<typeof compat.YAMLMap>;
  const get = (key: string) => root.items.find((pair) => pair.key instanceof compat.Scalar && pair.key.value === key)!.value;
  const base = get("base");
  const copy = get("copy");
  ok(base instanceof compat.YAMLMap);
  ok(copy instanceof compat.Alias);
  strictEqual((copy as InstanceType<typeof compat.Alias>).resolve(doc), base);
  const value = doc.toJS() as Record<string, unknown>;
  strictEqual(value.base, value.copy);
  const self = value.self as unknown[];
  strictEqual(self[0], self);
  const mapValues = doc.toJS({ mapAsMap: true }) as Map<unknown, unknown>;
  ok(mapValues.get("base") instanceof Map);
  ok([...mapValues.keys()].some(Array.isArray));
  ok([...mapValues.keys()].some((key) => key instanceof Map));
  ok(doc.clone() instanceof compat.Document);
  strictEqual(doc.toString().includes("base:"), true);
  ok(root.srcToken);
  const parsedDocToken = sourceTokens.find((token) => token.type === "document");
  ok(parsedDocToken?.type === "document");
  const parserDoc = [...new compat.Composer({ keepSourceTokens: true }).compose(sourceTokens)][0]!;
  const parserRoot = parserDoc.contents as InstanceType<typeof compat.YAMLMap>;
  strictEqual(parserRoot.srcToken, parsedDocToken.value);
  throws(() => compat.parse("a: 1", { keepSourceTokens: true }));
  throws(() => compat.parseDocument("a: 1", { mapAsMap: true }));
  throws(() => new compat.Composer({ schema: "json" } as never));
  throws(() => new compat.Composer({ resolveKnownTags: false } as never));
  throws(() => new compat.Document(undefined, { version: "1.1" } as never));
  deepStrictEqual(
    compat.parseDocument("value: 999999999999999999999", { intAsBigInt: true }).toJS(),
    { value: 999999999999999999999n },
  );
  const tagged = compat.parseDocument("value: !!binary AQI=", { resolveKnownTags: true, logLevel: "silent" });
  deepStrictEqual([...(tagged.toJS() as { value: Uint8Array }).value], [1, 2]);
});

test("source directives reject unsupported versions and repeated handles, then reset per document", () => {
  const docs = compat.parseAllDocuments("%YAML 1.1\n---\na: yes\n---\nb: yes\n");
  strictEqual(docs.length, 2);
  ok(docs[0]!.errors.some((error) => error.code === "BAD_DIRECTIVE"));
  strictEqual((docs[0]!.toJS() as Record<string, unknown>).a, "yes");
  strictEqual((docs[1]!.toJS() as Record<string, unknown>).b, "yes");
  const repeated = compat.parseDocument("%TAG !e! tag:one.example,2020:\n%TAG !e! tag:two.example,2020:\n---\na: !e!x value\n");
  ok(repeated.errors.some((error) => error.code === "BAD_DIRECTIVE"));
  const reset = compat.parseAllDocuments("%TAG !e! tag:one.example,2020:\n---\na: !e!x one\n%TAG !e! tag:two.example,2020:\n---\nb: !e!x two\n");
  strictEqual(reset.length, 2);
  strictEqual(reset.every((doc) => !doc.errors.some((error) => error.code === "BAD_DIRECTIVE")), true);
  const highVersion = compat.parseDocument("%YAML 2.0\n---\na: yes\n");
  ok(highVersion.errors.some((error) => error.code === "BAD_DIRECTIVE"));
  strictEqual((highVersion.toJS() as Record<string, unknown>).a, "yes");
  strictEqual(compat.parseDocument("{[a, b]: value}").errors.some((error) => error.message.includes("Implicit flow collection keys")), true);
  strictEqual(compat.parseDocument("{? [a, b]: value}").errors.some((error) => error.message.includes("Implicit flow collection keys")), false);
});

test("Composer preserves empty-stream state, first-document diagnostics, source tokens and duplicate AST pairs", () => {
  const emptyComposer = new compat.Composer();
  strictEqual([...emptyComposer.compose([])].length, 0);
  strictEqual(emptyComposer.streamInfo().errors.length, 0);
  const forced = [...new compat.Composer().compose([], true, 0)];
  deepStrictEqual(forced[0]?.range, [0, 0, 0]);

  const multiple = compat.parseDocument("---\na: 1\n---\nb: 2\n");
  strictEqual((multiple.toJS() as Record<string, unknown>).a, 1);
  ok(multiple.errors.some((error) => error.code === "MULTIPLE_DOCS"));

  const source = "a: 1\na: 2\n";
  const tokens = [...new compat.Parser().parse(source)];
  const token = tokens.find((item) => item.type === "document");
  ok(token?.type === "document" && token.value?.type === "block-map");
  const composed = [...new compat.Composer({ keepSourceTokens: true }).compose(tokens)][0]!;
  const map = composed.contents as InstanceType<typeof compat.YAMLMap>;
  strictEqual(map.items.length, 2);
  strictEqual(map.srcToken, token.value);
  strictEqual(map.items[0]!.srcToken, token.value.items[0]);
  strictEqual((composed.toJS() as Record<string, unknown>).a, 2);
  const unique = compat.parseDocument(source, { uniqueKeys: true });
  ok(unique.errors.some((error) => error.code === "DUPLICATE_KEY"));
});

test("source line counters and pretty diagnostics use absolute UTF-16 positions", () => {
  const lineCounter = new compat.LineCounter();
  const source = "\ufeffa: 😀\r\nb: [1, 2\r\n";
  const doc = compat.parseDocument(source, { lineCounter, prettyErrors: true });
  deepStrictEqual(lineCounter.lineStarts, [0, 8, 18]);
  const error = doc.errors.find((item) => item.code === "BAD_INDENT");
  ok(error?.linePos);
  strictEqual(error.pos[0], 18);
  strictEqual(error.linePos[0]?.line, 3);
  strictEqual(error instanceof compat.YAMLParseError, true);
  strictEqual(doc.contents instanceof compat.YAMLMap, true);
});

test("source document writer serializes only a Uint8Array subview", () => {
  const backing = Uint8Array.from([0, 1, 2, 3]);
  const view = backing.subarray(1, 3);
  const doc = new compat.Document();
  doc.schema.tags.push(binary);
  const scalar = new compat.Scalar(view);
  scalar.tag = binary.tag;
  doc.contents = scalar;
  ok(doc.toString().includes("AQI="));
  strictEqual(doc.toString().includes("AAECAw=="), false);
});

test("seeded JSON-like values compose and convert with exact values and clean diagnostics", () => {
  fc.assert(
    fc.property(jsonValueArb, (value) => {
      const source = compat.stringify(value);
      const doc = compat.parseDocument(source);
      deepStrictEqual(doc.toJS(), value);
      deepStrictEqual(doc.errors, []);
      strictEqual(doc.range?.[0], 0);
      strictEqual(doc.range?.[2], source.length);
    }),
    { seed: 21021, numRuns: 100 },
  );
});

test("seeded Documents match reference writing across selected styles and convert back", () => {
  const writerOptionsArb = fc.record({
    collectionStyle: fc.constantFrom("any" as const, "block" as const, "flow" as const),
    indent: fc.constantFrom(1, 2, 4),
    lineWidth: fc.constantFrom(0, 40, 80),
    singleQuote: fc.boolean(),
  });
  fc.assert(
    fc.property(jsonValueArb, writerOptionsArb, (value, writerOptions) => {
      const referenceText = new reference.Document(value).toString(writerOptions);
      const sourceText = new compat.Document(value).toString(writerOptions);
      strictEqual(sourceText, referenceText);
      deepStrictEqual(compat.parseDocument(sourceText).toJS(), reference.parseDocument(referenceText).toJS());
    }),
    { seed: 21022, numRuns: 100 },
  );

  const doc = new compat.Document({ nested: [1, 2], removed: true });
  const clone = doc.clone();
  strictEqual(doc.getIn(["nested", 1]), 2);
  doc.setIn(["nested", 1], 3);
  strictEqual(doc.delete("removed"), true);
  deepStrictEqual(doc.toJS(), { nested: [1, 3] });
  deepStrictEqual(clone.toJS(), { nested: [1, 2], removed: true });
});

test("Composer next/end retains source offsets over every split of recovery fixtures", () => {
  for (const source of [
    '---\nfirst: 0\n---\n["key\n value": 1]\n---\nlast: 2\n',
    '---\na: [1, 2\n---\ngood: 2\n',
    '---\na: [1, 2\n...\nb: 2\n',
    'a: "open\n---\nb: 2\n',
    '\ufeffa: 😀\r\nb: 2\r\n',
    '[a, --- , b]\n',
    '[a, ... , b]\n',
    'x: [a, --- , b]\n',
    '---x\n  ---\nkey: text\n',
    'text: |\n  ---\n',
    'text: "---"\n',
  ]) {
    const whole = compat.parseAllDocuments(source);
    const expected = whole.map((doc) => ({ range: doc.range, errors: doc.errors.map((error) => [error.code, error.pos]), contents: doc.toJS() }));
    for (let split = 0; split <= source.length; split++) {
      const parser = new compat.Parser();
      const composer = new compat.Composer({ keepSourceTokens: true });
      const actual: InstanceType<typeof compat.Document>[] = [];
      const push = (tokens: Iterable<CSTToken>) => { for (const token of tokens) actual.push(...composer.next(token)); };
      push(parser.parse(source.slice(0, split), true));
      push(parser.parse(source.slice(split)));
      actual.push(...composer.end());
      deepStrictEqual(actual.map((doc) => ({ range: doc.range, errors: doc.errors.map((error) => [error.code, error.pos]), contents: doc.toJS() })), expected, `${JSON.stringify(source)} @ ${split}`);
    }
  }
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
  const worker = new Worker(new URL("./source-parser-worker.mjs", import.meta.url), { workerData: source });
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("source parser exceeded 4 second termination guard"));
    }, 4000);
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("message", async (result: { ranges: number[][]; itemCount: number; middleErrors: string[]; finalValue: unknown }) => {
      clearTimeout(timeout);
      await worker.terminate();
      try {
        deepStrictEqual(result.ranges, [[0, 9, 9], [9, 22, 22], [22, 31, 31]]);
        strictEqual(result.itemCount, 2);
        ok(result.middleErrors.includes("BAD_INDENT"));
        deepStrictEqual(result.finalValue, { c: 3 });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test("single-quoted folding stays bounded on long final indentation", () => {
  const source = "'a\n" + " ".repeat(64 * 1024) + "x'";
  const worker = new Worker(new URL("./source-scalar-fold-worker.mjs", import.meta.url), { workerData: source });
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = async (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      await worker.terminate();
      if (error) reject(error);
      else resolve();
    };
    worker.once("error", (error) => { void finish(error); });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) void finish(new Error(`source scalar worker exited with code ${code}`));
    });
    worker.on("message", (result: { ready?: boolean; value?: unknown; errors?: string[]; range?: number[]; sourceLength?: number }) => {
      if (result.ready) {
        timeout = setTimeout(() => { void finish(new Error("source scalar folding exceeded 5 second termination guard")); }, 5000);
        return;
      }
      try {
        deepStrictEqual(result.errors, []);
        strictEqual(result.value, "a x");
        deepStrictEqual(result.range, [0, source.length, source.length]);
        strictEqual(result.sourceLength, source.length);
        void finish();
      } catch (error) {
        void finish(error as Error);
      }
    });
  });
}, 7000);

test("flow scalar folding matches yaml 2.9.0 values, ranges and diagnostics", () => {
  const sources = [
    "'a\n b'",
    "'a\r\n b'",
    "'a\n \t\n\n b'",
    "'\n\na'",
    "'a\nb  \t'",
    "''",
    "'a''b'",
    "[plain\n  folded]",
    "[plain\r\n  folded]",
    "['a\r b']",
  ];
  for (const source of sources) {
    const actual = compat.parseDocument(source, { keepSourceTokens: true });
    const expected = reference.parseDocument(source, { keepSourceTokens: true });
    deepStrictEqual(actual.toJS(), expected.toJS(), source);
    deepStrictEqual(actual.range, expected.range, source);
    deepStrictEqual(actual.contents?.range, expected.contents?.range, source);
    deepStrictEqual(actual.errors.map(({ code, message, pos }) => ({ code, message, pos })), expected.errors.map(({ code, message, pos }) => ({ code, message, pos })), source);
    deepStrictEqual(actual.contents?.srcToken, expected.contents?.srcToken, source);
  }

  const bodyArb = fc.array(
    fc.constantFrom("a", "Z", " ", "\t", "\r", "\n", "'", "😀", "雪"),
    { maxLength: 40 },
  ).map((chars) => chars.join(""));
  fc.assert(
    fc.property(bodyArb, (body) => {
      const source = `'${body.replaceAll("'", "''")}'`;
      const actual = compat.parseDocument(source, { keepSourceTokens: true });
      const expected = reference.parseDocument(source, { keepSourceTokens: true });
      deepStrictEqual(actual.toJS(), expected.toJS(), source);
      deepStrictEqual(actual.range, expected.range, source);
      deepStrictEqual(actual.contents?.range, expected.contents?.range, source);
      deepStrictEqual(actual.errors.map(({ code, message, pos }) => ({ code, message, pos })), expected.errors.map(({ code, message, pos }) => ({ code, message, pos })), source);
      deepStrictEqual(actual.contents?.srcToken, expected.contents?.srcToken, source);
    }),
    { seed: 21023, numRuns: 200 },
  );
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

test("chunking between indentation spaces preserves the upstream segmentation difference", () => {
  const source = `---\npayload:\n  - "a"\nquoted: "\\"aa"\n...\n`;
  const split = 14;

  function run(Parser: ParserConstructor) {
    const wholeLines: number[] = [];
    const whole = [...new Parser((offset) => wholeLines.push(offset)).parse(source)];
    const chunkLines: number[] = [];
    const parser = new Parser((offset) => chunkLines.push(offset));
    const chunk = [
      ...parser.parse(source.slice(0, split), true),
      ...parser.parse(source.slice(split), false),
    ];
    const doc = (tokens: CSTToken[]) => tokens.find((token) => token.type === "document")!;
    const indentationSpaces = (tokens: CSTToken[]) => (doc(tokens).value as { items: { sep?: { type: string; offset: number; source: string }[] }[] }).items[0]!.sep!
      .filter((token) => token.type === "space")
      .map(({ offset, source: text }) => ({ offset, source: text }));
    const compose = (tokens: CSTToken[]) => [...new reference.Composer().compose(tokens)].map((document) => ({
      value: document.toJSON(),
      errors: document.errors.map(({ code, message }) => ({ code, message })),
    }));

    return {
      whole,
      chunk,
      wholeLines,
      chunkLines,
      wholeSpaces: indentationSpaces(whole),
      chunkSpaces: indentationSpaces(chunk),
      wholeSource: whole.map((token) => reference.CST.stringify(token)).join(""),
      chunkSource: chunk.map((token) => reference.CST.stringify(token)).join(""),
      wholeDocuments: compose(whole),
      chunkDocuments: compose(chunk),
    };
  }

  function lex(Lexer: new () => { lex(source: string, incomplete?: boolean): Iterable<string> }) {
    const whole = [...new Lexer().lex(source)];
    const lexer = new Lexer();
    const chunk = [
      ...lexer.lex(source.slice(0, split), true),
      ...lexer.lex(source.slice(split), false),
    ];
    return { whole, chunk };
  }

  const expected = run(reference.Parser);
  const actual = run(compat.Parser);
  const expectedLexemes = lex(reference.Lexer);
  const actualLexemes = lex(compat.Lexer);
  deepStrictEqual(actual.whole, expected.whole);
  deepStrictEqual(actual.chunk, expected.chunk);
  deepStrictEqual(actualLexemes, expectedLexemes);
  deepStrictEqual(expectedLexemes.whole.slice(6, 9), ["\n", "  ", "-"]);
  deepStrictEqual(expectedLexemes.chunk.slice(6, 11), ["\n", " ", " ", "-", " "]);
  deepStrictEqual(expected.wholeSpaces, [{ offset: 13, source: "  " }]);
  deepStrictEqual(expected.chunkSpaces, [
    { offset: 13, source: " " },
    { offset: 14, source: " " },
  ]);
  deepStrictEqual(expected.wholeLines, [0, 4, 13, 21, 36, 40]);
  deepStrictEqual(expected.chunkLines, expected.wholeLines);
  strictEqual(expected.wholeSource, source);
  strictEqual(expected.chunkSource, source);
  deepStrictEqual(expected.wholeDocuments, [{
    value: { payload: ["a"], quoted: '"aa' },
    errors: [],
  }]);
  deepStrictEqual(expected.chunkDocuments, expected.wholeDocuments);
  deepStrictEqual(actual.wholeSpaces, expected.wholeSpaces);
  deepStrictEqual(actual.chunkSpaces, expected.chunkSpaces);
  deepStrictEqual(actual.wholeLines, expected.wholeLines);
  deepStrictEqual(actual.chunkLines, expected.chunkLines);
  strictEqual(actual.wholeSource, source);
  strictEqual(actual.chunkSource, source);
  deepStrictEqual(actual.wholeDocuments, expected.wholeDocuments);
  deepStrictEqual(actual.chunkDocuments, expected.chunkDocuments);
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
      const chunkTokens = parseChunks(source, cuts);
      deepStrictEqual(chunkTokens, parseChunks(source, cuts, reference.Parser));
      deepStrictEqual(chunkTokens, tokens);

      const sourceDocuments = [...new compat.Composer().compose(chunkTokens, true, source.length)];
      const referenceDocuments = reference.parseAllDocuments(source);
      deepStrictEqual(sourceDocuments.map((doc) => doc.toJS()), referenceDocuments.map((doc) => doc.toJS()));
      deepStrictEqual(sourceDocuments.map((doc) => doc.range), referenceDocuments.map((doc) => doc.range));
      deepStrictEqual(
        sourceDocuments.map((doc) => doc.errors.map((error) => ({ code: error.code, pos: error.pos }))),
        referenceDocuments.map((doc) => doc.errors.map((error) => ({ code: error.code, pos: error.pos }))),
      );
    }),
    { numRuns: 300, seed: 20261020 },
  );
});

test("parse path reports initial and CRLF newline offsets", () => {
  const offsets: number[] = [];
  [...new compat.Parser((offset) => offsets.push(offset)).parse("\ufeffa: 😀\r\nb: 2\r\n")];
  deepStrictEqual(offsets, [0, 8, 14]);
});
