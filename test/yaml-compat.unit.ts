/**
 * Unit tests for the yaml compatibility shim.
 * Run with: node --import tsx --test test/yaml-compat.unit.ts
 */

import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws, ok } from "node:assert";
import * as yamlReal from "yaml";
import yamlCompatDefault, { parse, parseAllDocuments, parseDocument, stringify, Composer, Document, YAMLMap, Scalar, Schema, isDocument, isMap, visit, YAMLParseError, YAMLWarning, YAMLError } from "../src/yaml-compat.ts";
import { parse as coreParse, parseAll as coreParseAll, requiredDocumentOptions, yamlDocumentOptions, YAMLParseError as CoreYAMLParseError } from "../src/core.ts";
import { load, YAMLException } from "../src/js-yaml-compat.ts";

const basicDocs = [
  ["plain map", "a: 1\nb: two\nc: true\n"],
  ["sequence", "- 1\n- 2\n- 3\n"],
  ["nested block map", "a:\n  b:\n    c: 1\n  d: 2\ne: 3\n"],
  ["flow map", "{a: 1, b: [2, 3], c: {d: 4}}"],
] as const;

for (const [label, text] of basicDocs) {
  test(`yaml-compat.parse matches real yaml.parse · ${label}`, () => {
    deepStrictEqual(parse(text), yamlReal.parse(text));
  });
}

const MULTI_DOC = "---\na: 1\n---\nb: 2\n---\nc: 3\n";
const DUMP_VALUE = { name: "svc", replicas: 3, enabled: true, tags: ["a", "b"] };
const PARSE_THROWS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["mapAsMap", { mapAsMap: true }],
  ["maxAliasCount", { maxAliasCount: 10 }],
  ["merge", { merge: true }],
  ["schema:json", { schema: "json" }],
  ["version:1.1", { version: "1.1" }],
  ["unknown key", { nope: 1 }],
];

for (const [label, opts] of PARSE_THROWS) {
  test(`yaml-compat.parse throws · ${label}`, () => {
    throws(() => parse("a: 1\n", opts));
  });
  test(`yaml-compat.parseAllDocuments throws · ${label}`, () => {
    throws(() => parseAllDocuments("a: 1\n", opts));
  });
  test(`yaml-compat.parseDocument throws · ${label}`, () => {
    throws(() => parseDocument("a: 1\n", opts));
  });
}


test("yaml-compat: named exports exist with the right shapes", () => {
  strictEqual(typeof parse, "function");
  strictEqual(typeof parseAllDocuments, "function");
  strictEqual(typeof parseDocument, "function");
  strictEqual(typeof stringify, "function");
  strictEqual(typeof Composer, "function");
  strictEqual(typeof Document, "function");
  strictEqual(typeof YAMLMap, "function");
  strictEqual(typeof Scalar, "function");
  strictEqual(typeof Schema, "function");
  strictEqual(typeof visit, "function");
  strictEqual(typeof YAMLParseError, "function");
  strictEqual(typeof YAMLWarning, "function");
});

test("yaml-compat: default export object mirrors the named exports", () => {
  strictEqual(yamlCompatDefault.parse, parse);
  strictEqual(yamlCompatDefault.parseAllDocuments, parseAllDocuments);
  strictEqual(yamlCompatDefault.parseDocument, parseDocument);
  strictEqual(yamlCompatDefault.stringify, stringify);
  deepStrictEqual(yamlCompatDefault.parse("a: 1\n"), { a: 1 });
});

test("yaml-compat.parseAllDocuments(...).map(d => d.toJS()) matches the real yaml library", () => {
  const ours = parseAllDocuments(MULTI_DOC).map((d) => d.toJS());
  const real = yamlReal.parseAllDocuments(MULTI_DOC).map((d) => d.toJS());
  deepStrictEqual(ours, real);
});

test("yaml-compat.parseDocument wraps a single document like parseAllDocuments' first entry", () => {
  const doc = parseDocument("a: 1\nb: 2\n");
  deepStrictEqual(doc.toJS(), { a: 1, b: 2 });
  deepStrictEqual(doc.toJSON(), { a: 1, b: 2 });
  ok(doc instanceof Document);
  ok(isDocument(doc));
  ok(doc.contents instanceof YAMLMap);
  ok(isMap(doc.contents));
  deepStrictEqual(doc.contents.toJS(doc), { a: 1, b: 2 });
  deepStrictEqual(doc.errors, []);
  deepStrictEqual(doc.warnings, []);
});

test("yaml-compat.parse syntax errors use the shared canonical YAMLParseError class", () => {
  const source = "a: [1,";
  const documentError = parseDocument(source).errors[0]!;
  const capture = (run: () => unknown) => {
    try {
      run();
      throw new Error("expected parse to fail");
    } catch (error) {
      return error as YAMLParseError;
    }
  };
  const error = capture(() => parse(source));
  strictEqual(yamlCompatDefault.YAMLParseError, YAMLParseError);
  ok(error instanceof YAMLParseError);
  ok(error instanceof YAMLError);
  ok(error instanceof Error);
  strictEqual(error.constructor, YAMLParseError);
  strictEqual(error.code, documentError.code);
  deepStrictEqual(error.pos, documentError.pos);
  strictEqual(error.message, documentError.message);
  deepStrictEqual(error.linePos, documentError.linePos);

  const noPrettyDocumentError = parseDocument(source, { prettyErrors: false }).errors[0]!;
  const noPrettyError = capture(() => parse(source, { prettyErrors: false }));
  strictEqual(noPrettyError.code, noPrettyDocumentError.code);
  deepStrictEqual(noPrettyError.pos, noPrettyDocumentError.pos);
  strictEqual(noPrettyError.message, noPrettyDocumentError.message);
  strictEqual(noPrettyError.linePos, undefined);

  const unicodeSource = 'title: "😀"\r\nitems: [1,';
  const unicodeDocumentError = parseDocument(unicodeSource).errors[0]!;
  const unicodeError = capture(() => parse(unicodeSource));
  strictEqual(unicodeError.code, unicodeDocumentError.code);
  deepStrictEqual(unicodeError.pos, unicodeDocumentError.pos);
  strictEqual(unicodeError.message, unicodeDocumentError.message);
  deepStrictEqual(unicodeError.linePos, unicodeDocumentError.linePos);

  const constructed = new YAMLParseError([2, 3], "MISSING_CHAR", "message");
  ok(constructed instanceof YAMLError);
  deepStrictEqual(constructed.pos, [2, 3]);
  strictEqual(constructed.code, "MISSING_CHAR");
  strictEqual(constructed.message, "message");
  const raw = [...new Composer().compose(
    new yamlCompatDefault.Parser().parse(source), true, source.length
  )][0]!;
  strictEqual(raw.errors[0]?.constructor, YAMLParseError);
  strictEqual(documentError.constructor, YAMLParseError);
});

test("successful yaml-compat.parse does not enter the source diagnostic pipeline", () => {
  const parserPrototype = yamlCompatDefault.Parser.prototype;
  const originalParse = parserPrototype.parse;
  let sourceParserCalls = 0;
  Reflect.set(parserPrototype, "parse", function (this: unknown, ...args: Parameters<typeof originalParse>) {
    sourceParserCalls++;
    return Reflect.apply(originalParse, this, args);
  });
  try {
    deepStrictEqual(parse("answer: 42\n"), { answer: 42 });
  } finally {
    Reflect.set(parserPrototype, "parse", originalParse);
  }
  strictEqual(sourceParserCalls, 0);
});

test("yaml-compat.parse canonicalizes depth errors and preserves reviver throws", () => {
  const nested = "[".repeat(1100) + "0" + "]".repeat(1100);
  let depthError: unknown;
  try {
    parse(nested);
  } catch (error) {
    depthError = error;
  }
  ok(depthError instanceof YAMLParseError);
  strictEqual((depthError as YAMLParseError).code, "RESOURCE_EXHAUSTION");

  const ordinarySentinel = new Error("reviver failed");
  let ordinaryThrown: unknown;
  try {
    parse("a: 1", (_key, _value) => { throw ordinarySentinel; });
  } catch (error) {
    ordinaryThrown = error;
  }
  strictEqual(ordinaryThrown, ordinarySentinel);

  const coreSentinel = new CoreYAMLParseError("reviver core sentinel");
  let coreThrown: unknown;
  try {
    parse("a: 1", (_key, _value) => { throw coreSentinel; });
  } catch (error) {
    coreThrown = error;
  }
  strictEqual(coreThrown, coreSentinel);
});

test("source-clean diagnostics never turn a core parse failure into success", () => {
  const source = "---\n[ a, b, c, ]#invalid\n";
  strictEqual(parseDocument(source, {
    strict: false,
    uniqueKeys: false,
    prettyErrors: false,
  }).errors.length, 0);
  let coreError: unknown;
  try {
    coreParse(source, yamlDocumentOptions);
  } catch (error) {
    coreError = error;
  }
  ok(coreError instanceof CoreYAMLParseError);
  let compatError: unknown;
  try {
    parse(source);
  } catch (error) {
    compatError = error;
  }
  ok(compatError instanceof YAMLParseError);
  strictEqual((compatError as YAMLParseError).code, "UNEXPECTED_TOKEN");
  strictEqual((compatError as YAMLParseError).message, (coreError as Error).message);
  strictEqual((compatError as YAMLParseError).pos[0], source.indexOf("#"));
  strictEqual((compatError as YAMLParseError).pos[1], source.indexOf("#"));
  strictEqual((compatError as YAMLParseError).linePos, undefined);
});

test("public source documents retain native diagnostics, offsets, and editable nodes", () => {
  const source = "# heading\r\n---\r\nvalue: [1, 2]\r\n";
  const doc = parseDocument(source, { keepSourceTokens: true });
  ok(doc.contents instanceof YAMLMap);
  strictEqual(doc.range[0], source.indexOf("---"));
  ok(doc.contents.srcToken);
  const tokens = [...new yamlCompatDefault.Parser().parse(source)];
  const streamed = [...new Composer({ keepSourceTokens: true }).compose(tokens)];
  const sourceDocument = tokens.find((token) => token.type === "document");
  ok(sourceDocument?.type === "document");
  strictEqual(streamed[0]?.contents?.srcToken, sourceDocument.value);
  doc.setIn(["value", 0], 9);
  deepStrictEqual(doc.toJS(), { value: [9, 2] });
  strictEqual(isDocument(doc), true);
  let visited = 0;
  visit(doc, () => { visited++; });
  ok(visited > 0);
});

test("source-only options are forwarded, while conversion options stay on toJS", () => {
  const conversionOptions = { mapAsMap: true };
  throws(() => Reflect.apply(parseDocument, undefined, ["a: 1\n", conversionOptions]));
  const source = "a: [1, 2]\n";
  deepStrictEqual(parseDocument(source, { strict: false }).toJS(), { a: [1, 2] });
  const counter = new yamlCompatDefault.LineCounter();
  const doc = parseDocument("a: [1,\n", { lineCounter: counter, prettyErrors: false });
  ok(doc.errors.length > 0);
  strictEqual(counter.lineStarts.length, 2);
  strictEqual(doc.errors[0]?.linePos, undefined);
  const pretty = parseDocument("a: [1,\n");
  ok(pretty.errors[0]?.message.includes(" at line "));
  deepStrictEqual(pretty.errors[0]?.linePos?.[0], { line: 2, col: 1 });
  const warning = parseDocument("value: !unknown text\n");
  ok(warning.warnings[0]?.linePos?.[0]);
  ok(warning.warnings[0]?.message.includes(" at line 1, column 8"));
  const empty = parseAllDocuments("# stream comment\n");
  ok("empty" in empty && empty.empty);
  strictEqual(empty.comment, " stream comment");
  deepStrictEqual(parseDocument("integer: 9007199254740993\n", { intAsBigInt: true }).toJS(), { integer: 9007199254740993n });
});

test("native custom scalar and collection tags are explicit and usable", () => {
  const include = {
    tag: "!include",
    resolve: (value: string) => ({ include: value }),
    identify: (value: unknown) => !!value && typeof value === "object" && "include" in value,
    createNode: (_schema: unknown, value: unknown) => new Scalar(value),
  };
  const docs = parseAllDocuments("entry: !include ./part.yaml\n", { customTags: [include] });
  deepStrictEqual(docs[0]?.toJS(), { entry: { include: "./part.yaml" } });
  const mapping = {
    collection: "map" as const,
    tag: "!dict",
    nodeClass: YAMLMap,
    identify: (value: unknown) => value instanceof Map,
  };
  const collectionDoc = parseDocument("settings: !dict {mode: safe}\n", { customTags: [mapping] });
  deepStrictEqual(collectionDoc.toJS(), { settings: { mode: "safe" } });
  const direct = new Document(undefined, { customTags: (tags) => [...tags, include] });
  const node = direct.createNode({ include: "x" }, { tag: "!include" });
  ok(node instanceof Scalar);
  const mapDoc = new Document(new Map([["mode", "safe"]]), { customTags: [mapping], tag: "!dict" });
  ok(mapDoc.contents instanceof YAMLMap);
  deepStrictEqual(parseDocument(mapDoc.toString(), { customTags: [mapping] }).toJS(), { mode: "safe" });
  ok(new Schema({ customTags: [include] }) instanceof Schema);
  throws(() => new Composer({ version: "1.1" }));
  throws(() => new Schema({ schema: "yaml-1.1" }));
  throws(() => new Document(undefined, { merge: false }));
});

test("default native schema rejects automatic timestamp and merge typing but keeps binary", () => {
  const timestampSource = "value: !!timestamp 2020-01-01\n";
  const timestamp = parseDocument(timestampSource);
  ok(timestamp.errors.some((error) => error.code === "TAG_RESOLVE_FAILED"));
  ok(!((timestamp.toJS() as { value: unknown }).value instanceof Date));
  const directTimestamp = [...new Composer().compose(
    new yamlCompatDefault.Parser().parse(timestampSource), true, timestampSource.length
  )][0]!;
  ok(directTimestamp.errors.some((error) => error.code === "TAG_RESOLVE_FAILED"));
  ok(!((directTimestamp.toJS() as { value: unknown }).value instanceof Date));

  const mergeSource = "base: &base {x: 1}\n!!merge <<: *base\n";
  const merge = parseDocument(mergeSource);
  ok(merge.errors.some((error) => error.code === "TAG_RESOLVE_FAILED"));
  deepStrictEqual(merge.toJS(), { base: { x: 1 }, "<<": { x: 1 } });
  const directMerge = [...new Composer().compose(
    new yamlCompatDefault.Parser().parse(mergeSource), true, mergeSource.length
  )][0]!;
  ok(directMerge.errors.some((error) => error.code === "TAG_RESOLVE_FAILED"));
  deepStrictEqual(directMerge.toJS(), { base: { x: 1 }, "<<": { x: 1 } });
  const binary = parseDocument("value: !!binary AQID\n");
  ok((binary.toJS() as { value: unknown }).value instanceof Uint8Array);
  ok("tag:yaml.org,2002:binary" in new Schema({}).knownTags);
  ok(!("tag:yaml.org,2002:timestamp" in new Schema({}).knownTags));
  ok(!("tag:yaml.org,2002:merge" in new Schema({}).knownTags));
  throws(() => new Schema({ customTags: ["timestamp"] }));
  throws(() => new Document(undefined, { schema: "yaml-1.1" }));
});

test("legacy numeric tag shorthands cannot bypass core source typing", () => {
  const rejected = (run: () => unknown) => {
    try {
      run();
      return false;
    } catch {
      return true;
    }
  };
  deepStrictEqual([
    rejected(() => parseDocument("x: 1:20\n", { customTags: ["intTime"] })),
    rejected(() => parseAllDocuments("# comment only\n", { customTags: ["intTime"] })),
    rejected(() => new Composer({ customTags: ["intTime"] })),
    rejected(() => new Schema({ schema: "core", customTags: ["intTime"] })),
    rejected(() => parseDocument("x: 1:20.5\n", { customTags: ["floatTime"] })),
    rejected(() => new Schema({ schema: "core", customTags: ["floatTime"] })),
  ], [true, true, true, true, true, true]);
  for (const tag of ["merge", "omap", "pairs", "set", "timestamp"] as const) {
    ok(rejected(() => new Schema({ schema: "core", customTags: [tag] })));
  }
  ok(new Schema({ schema: "core", customTags: ["binary", "int"] }) instanceof Schema);
  ok(new Schema({
    schema: "core",
    customTags: tags => [...tags, "binary"],
  }) instanceof Schema);
  let callbackCalls = 0;
  throws(() => parseDocument("x: 1:20\n", {
    customTags: tags => {
      callbackCalls++;
      return [...tags, "intTime"];
    },
  }));
  strictEqual(callbackCalls, 1);
});

test("single-document diagnostics identify extra documents and honor silent log level", () => {
  const source = "first: 1\n---\nsecond: 2\n";
  const doc = parseDocument(source);
  const error = doc.errors.find(item => item.code === "MULTIPLE_DOCS");
  ok(error instanceof YAMLParseError);
  strictEqual(error.pos[0], source.indexOf("---"));
  ok(error.message.includes(" at line 2, column 1"));
  strictEqual(parseDocument(source, { logLevel: "silent" }).errors.length, 0);
});

test("yaml compatibility preserves yaml 2.9 suffix document counting", () => {
  const cases: Array<[string, unknown[]]> = [
    ["...", [null]],
    ["...\n...\n", [null, null]],
    ["...\na: 1\n", [null, { a: 1 }]],
    ["---\n...\n...\n", [null, null]],
    ["x\n...\n...\n", ["x", null]],
    ["...\n---\n", [null, null]],
    ["...\n%YAML 1.2\n---\na: 1\n", [null, { a: 1 }]],
    ["\ufeff... # end\r\n# between\r\n...\r\n", [null, null]],
    ["...x", ["...x"]],
  ];
  for (const [input, expected] of cases) {
    const referenceDocs = yamlReal.parseAllDocuments(input);
    deepStrictEqual(referenceDocs.map((doc) => doc.toJS()), expected, input);
    const candidateDocs = parseAllDocuments(input);
    deepStrictEqual(candidateDocs.map((doc) => doc.toJS()), expected, input);
    deepStrictEqual(candidateDocs.map((doc) => doc.errors.length), referenceDocs.map((doc) => doc.errors.length), input);

    const referenceDocument = yamlReal.parseDocument(input);
    const candidateDocument = parseDocument(input);
    deepStrictEqual(candidateDocument.toJS(), referenceDocument.toJS(), input);
    strictEqual(candidateDocument.errors.length > 0, referenceDocument.errors.length > 0, input);

    if (expected.length > 1) {
      throws(() => yamlReal.parse(input));
      throws(() => parse(input));
    } else {
      deepStrictEqual(parse(input), yamlReal.parse(input));
    }
  }

  let revived = 0;
  throws(() => parse("...\n...", (_key, value) => { revived++; return value; }));
  strictEqual(revived, 0);
});

test("yaml compatibility retains invalid marker and late-document recovery behavior", () => {
  for (const input of ["%YAML 1.2\n...\n", "... garbage\n"]) {
    const referenceDocs = yamlReal.parseAllDocuments(input);
    const candidateDocs = parseAllDocuments(input);
    strictEqual(candidateDocs.some((doc) => doc.errors.length > 0), referenceDocs.some((doc) => doc.errors.length > 0));
    strictEqual(parseDocument(input).errors.length > 0, yamlReal.parseDocument(input).errors.length > 0);
  }

  for (const input of ["...\n[", "---\nnull\n...\n...\n["]) {
    const docs = parseAllDocuments(input);
    const referenceDocs = yamlReal.parseAllDocuments(input);
    strictEqual(docs.length, referenceDocs.length);
    deepStrictEqual(docs.map(doc => doc.toJS()), referenceDocs.map(doc => doc.toJS()));
    ok(docs.some(doc => doc.errors.length > 0));
    const document = parseDocument(input);
    deepStrictEqual(document.toJS(), yamlReal.parseDocument(input).toJS());
    strictEqual(document.errors[0]?.code, "MULTIPLE_DOCS");
  }
});

test("core, js-yaml, and yaml keep suffix policies isolated by option identity", () => {
  ok(requiredDocumentOptions !== yamlDocumentOptions);
  strictEqual(Object.isFrozen(requiredDocumentOptions), true);
  strictEqual(Object.isFrozen(yamlDocumentOptions), true);

  deepStrictEqual(parse("..."), null);
  deepStrictEqual(parseAllDocuments("...").map((doc) => doc.toJS()), [null]);
  deepStrictEqual(coreParseAll("..."), []);
  strictEqual(coreParse("...", {}), null);
  deepStrictEqual(coreParseAll("...\n...", {}), []);
  throws(() => load("..."), (err: unknown) => err instanceof YAMLException);

  deepStrictEqual(parseAllDocuments("...\n..." ).map((doc) => doc.toJS()), [null, null]);
  throws(() => parse("...\n..."));
  throws(() => parse("...\n...", (_key, value) => value));
  deepStrictEqual(coreParseAll("...\n..."), []);
  throws(() => load("...\n..."), (err: unknown) => err instanceof YAMLException);

  deepStrictEqual(parseAllDocuments("...\na: 1\n").map((doc) => doc.toJS()), [null, { a: 1 }]);
  throws(() => parse("...\na: 1\n"));
  deepStrictEqual(coreParse("...\na: 1\n"), { a: 1 });
  deepStrictEqual(load("...\na: 1\n"), { a: 1 });
  deepStrictEqual(parseAllDocuments("..." ).map((doc) => doc.toJS()), [null]);
});

test("yaml-compat.stringify emits YAML the real yaml reads back", () => {
  const text = stringify(DUMP_VALUE);
  strictEqual(typeof text, "string");
  deepStrictEqual(yamlReal.parse(text), DUMP_VALUE);
});

test("yaml-compat.parse/stringify accept honoured no-op options and the reviver", () => {
  deepStrictEqual(parse("a: 1\n", { schema: "core" }), { a: 1 });
  deepStrictEqual(parse("a: 1\n", { version: "1.2" }), { a: 1 });
  // The positional reviver still runs (it's honoured, not an option-bag key).
  deepStrictEqual(parse("a: 1\nb: 2\n", (k, v) => (k === "b" ? undefined : v)), { a: 1 });
  strictEqual(typeof stringify(DUMP_VALUE, { schema: "core" }), "string");
});

test("yaml-compat.stringify throws on options and on a replacer", () => {
  throws(() => stringify(DUMP_VALUE, { indent: 4 }));
  throws(() => stringify(DUMP_VALUE, { singleQuote: true }));
  // A JSON.stringify-style replacer (function or array) is not honoured yet.
  throws(() => stringify(DUMP_VALUE, (_k: string, v: unknown) => v));
  throws(() => stringify(DUMP_VALUE, ["name"]));
});

test("yaml-compat.stringify fails loud on the JSON.stringify-style indent shorthand (2- and 3-arg)", () => {
  // The indent-shorthand mechanism (a bare number/string = the JSON.stringify-style indent width/unit)
  // is spelled out in stringify's impl comment (src/yaml-compat.ts). What THIS test locks: every such
  // call fails loud — 2-arg AND 3-arg, and even indent 2 (== our default) — with a message naming the
  // indent shorthand, NOT a nonsensical `option "0"` (the index Object.keys("  ") would yield).
  for (const call of [
    () => stringify(DUMP_VALUE, null, 4),
    () => stringify(DUMP_VALUE, null, "  "),
    () => stringify(DUMP_VALUE, 4), // 2-arg numeric shorthand — real yaml reads it as indent 4
    () => stringify(DUMP_VALUE, "  "), // 2-arg string shorthand — real yaml reads it as indent = length
    () => stringify(DUMP_VALUE, 2),
  ]) {
    throws(call, (err: unknown) => err instanceof Error && err.message.includes("indent") && !err.message.includes('option "0"'));
  }
});

test("yaml-compat.stringify fails loud on a truthy sub-1 indent shorthand real yaml clamps to default", () => {
  // Real yaml's indent clamp rounds anything to < 1 down to its own default (confirmed live against real
  // yaml@2.9.0: `stringify(V, null, -3)`, `-0.5`, and `0.4` — Math.round(0.4) is 0 — all equal the
  // no-options output below) — so for real yaml a sub-1 width (negative or fractional) is a silent no-op,
  // not a throw. We don't replicate that clamp table (see the residual note in stringify's impl comment,
  // src/yaml-compat.ts) — every truthy numeric indent shorthand fails loud here, clamped-to-default or not,
  // in both the 2-arg and 3-arg forms.
  const nested = { a: { b: 1 } };
  strictEqual(yamlReal.stringify(nested, null, -3), yamlReal.stringify(nested));
  strictEqual(yamlReal.stringify(nested, null, -0.5), yamlReal.stringify(nested));
  strictEqual(yamlReal.stringify(nested, null, 0.4), yamlReal.stringify(nested));
  for (const call of [
    () => stringify(nested, -3),
    () => stringify(nested, -0.5),
    () => stringify(nested, 0.4),
    () => stringify(nested, null, -3),
    () => stringify(nested, null, -0.5),
    () => stringify(nested, null, 0.4),
  ]) {
    throws(call, (err: unknown) => err instanceof Error && err.message.includes("indent"));
  }
});

test("yaml-compat.stringify rejects a non-object options arg (boolean/symbol), matching real yaml's throw", () => {
  // Real yaml@2.9.0 throws a TypeError (`'indent' in <primitive>`) on a TRUTHY non-object promoted into
  // the options slot, and on any non-object handed directly as the 3rd arg — so `stringify(V, true)` and
  // `stringify(V, null, true|false|Symbol())` all throw. validateOptions tolerates a scalar (right for
  // parse/load/dump), so stringify rejects one at its own call site. A FALSY 2nd arg is NOT promoted —
  // it's tolerated as "no options" (see the falsy-tolerance test below).
  throws(() => stringify(DUMP_VALUE, true));
  throws(() => stringify(DUMP_VALUE, null, true));
  throws(() => stringify(DUMP_VALUE, null, false));
  throws(() => stringify(DUMP_VALUE, null, Symbol()));
});

test("yaml-compat.stringify tolerates a falsy 2nd-arg options slot (matches real yaml)", () => {
  // Real yaml promotes the 2nd arg to options only when TRUTHY (`options === undefined && replacer`), so a
  // falsy 2nd arg (`false`/`0`/`""`/`NaN` — e.g. a conditional `cond && replacer` with `cond` false) means "no
  // options" and yields DEFAULT output, not an error. Verified live against real yaml@2.9.0. Locks the
  // reachable `stringify(value, cond && replacer)` idiom (falsy `cond`).
  const def = stringify(DUMP_VALUE);
  for (const falsy of [false, 0, "", NaN] as unknown[]) {
    strictEqual(stringify(DUMP_VALUE, falsy), def);
    deepStrictEqual(yamlReal.parse(stringify(DUMP_VALUE, falsy)), DUMP_VALUE);
  }
});

test("yaml-compat.stringify tolerates an array in the 3rd-arg options slot (matches real yaml)", () => {
  // A 3-arg array in the options slot is spread-into-`{}`-and-ignored by real yaml (default output);
  // only a 2-arg array is a replacer (`stringify(v, [k])`), caught by the replacer guard above.
  strictEqual(stringify(DUMP_VALUE, null, [1, 2, 3]), stringify(DUMP_VALUE));
  deepStrictEqual(yamlReal.parse(stringify(DUMP_VALUE, null, [1, 2, 3])), DUMP_VALUE);
});

test("yaml-compat.parse tolerates a scalar/array options arg (matches real yaml)", () => {
  deepStrictEqual(parse("a: 1\n", 4 as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", 4 as never));
  deepStrictEqual(parse("a: 1\n", [1, 2, 3] as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", [1, 2, 3] as never));
  // A falsy 2nd arg is "no options" too — the same truthy gate as stringify (behaviour-neutral for parse).
  deepStrictEqual(parse("a: 1\n", false as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", false as never));
  deepStrictEqual(parse("a: 1\n", 0 as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", 0 as never));
});

test("yaml-compat.stringify throws on singleQuote at either value (our output already prefers single quotes)", () => {
  // We can't faithfully honour `false` (real yaml's double-quote default) any more than `true`,
  // so both fail loud rather than silently emit whichever quoting we happen to produce.
  throws(() => stringify(DUMP_VALUE, { singleQuote: false }));
  throws(() => stringify(DUMP_VALUE, { singleQuote: true }));
});

test("yaml-compat: unsupported-option error names the option", () => {
  try {
    parse("a: 1\n", { mapAsMap: true });
    throw new Error("expected parse() to throw");
  } catch (err) {
    ok(err instanceof Error);
    ok((err as Error).message.includes("mapAsMap"));
  }
});

test("yaml-compat.parse validates options in every call shape", () => {
  // reviver omitted as undefined/null, options in the 3rd slot
  throws(() => parse("a: 1\n", undefined, { mapAsMap: true }));
  throws(() => parse("a: 1\n", null, { mapAsMap: true }));
  // options as the 2nd arg (no reviver)
  throws(() => parse("a: 1\n", { mapAsMap: true }));
  // an honoured no-op still passes in the 3rd slot
  deepStrictEqual(parse("a: 1\n", undefined, { version: "1.2" }), { a: 1 });
});

test("yaml-compat.stringify validates options in every call shape", () => {
  // replacer omitted as null/undefined, options in the 3rd slot
  throws(() => stringify(DUMP_VALUE, null, { indent: 4 }));
  throws(() => stringify(DUMP_VALUE, undefined, { sortMapEntries: true }));
  // options as the 2nd arg
  throws(() => stringify(DUMP_VALUE, { indent: 4 }));
});

test("yaml-compat.parse/stringify a present 3rd-arg options bag wins over a no-op 2nd arg", () => {
  // Real yaml adopts the 2nd arg as options only in the 2-arg form; a present 3rd arg wins (confirmed:
  // real `stringify(V, {indent:4}, {indent:2})` emits indent 2, and `parse("99", {intAsBigInt:true}, {})`
  // yields a Number, not a BigInt). So a no-op 2nd arg must NOT mask an unsupported 3rd-arg option —
  // otherwise a relied-upon option is silently dropped.
  throws(() => stringify(DUMP_VALUE, { sortMapEntries: false }, { indent: 4 }));
  throws(() => parse("a: 1\n", { mapAsMap: false }, { intAsBigInt: true }));
});

test("yaml-compat accepts no-op default option values, rejects the active value", () => {
  // prettyErrors is a no-op — our errors already carry line/column
  deepStrictEqual(parse("a: 1\n", { prettyErrors: true }), { a: 1 });
  // the falsy default of each boolean feature-flag is a genuine no-op
  for (const opts of [{ mapAsMap: false }, { intAsBigInt: false }, { merge: false }, { uniqueKeys: false }] as Record<string, unknown>[]) {
    deepStrictEqual(parse("a: 1\n", opts), { a: 1 });
  }
  strictEqual(typeof stringify(DUMP_VALUE, { sortMapEntries: false }), "string");
  // ...but turning the feature on throws
  throws(() => parse("a: 1\n", { mapAsMap: true }));
  throws(() => parse("a: 1\n", { merge: true }));
});

test("explicit tagged and anchored collection values reach yaml compatibility APIs", () => {
  for (const source of ["? key\n: !!seq\n- entry\n", "? key\n: &a\n- entry\n"]) {
    deepStrictEqual(parse(source), { key: ["entry"] });
    deepStrictEqual(parseDocument(source).toJS(), { key: ["entry"] });
    deepStrictEqual(parseAllDocuments(source).map((doc) => doc.toJS()), [{ key: ["entry"] }]);
  }
});

test("yaml reviver walks and updates tagged sets and ordered maps", () => {
  const source = "!!omap [ { first: !!set { a: null, b: null } }, { second: 2 } ]";
  function revive(this: unknown, key: unknown, value: unknown): unknown {
    if (key === "a") return "renamed";
    if (key === "b" || key === "second") return undefined;
    return value;
  }
  deepStrictEqual(parse(source, revive), yamlReal.parse(source, revive));
  deepStrictEqual(parse(source, revive), new Map([["first", new Set(["renamed"])]]));
});

test("yaml reviver receives actual collection keys and holders", () => {
  const source = "!!omap [ { first: !!set { a: null } }, { second: 2 } ]";
  function calls(parser: (source: string, reviver: (this: unknown, key: unknown, value: unknown) => unknown) => unknown): unknown[] {
    const seen: unknown[] = [];
    parser(source, function (key, value) {
      seen.push([key, this instanceof Map ? "map" : this instanceof Set ? "set" : "object"]);
      return value;
    });
    return seen;
  }
  deepStrictEqual(calls(parse), calls(yamlReal.parse));
});

test("yaml reviver passes non-string members added to a later set", () => {
  const source = "before: 1\nitems: !!set { a: null }\n";
  function calls(parser: (source: string, reviver: (this: unknown, key: unknown, value: unknown) => unknown) => unknown): unknown[] {
    const seen: unknown[] = [];
    parser(source, function (this: unknown, key, value) {
      if (key === "before") ((this as { items: Set<unknown> }).items).add(7);
      seen.push(key);
      return value;
    });
    return seen;
  }
  deepStrictEqual(calls(parse), calls(yamlReal.parse));
  ok(calls(parse).includes(7));
});

test("yaml reviver does not reinsert a map member deleted by the callback", () => {
  const result = parse("!!omap [ { first: 1 }, { second: 2 } ]", function (key, value) {
    if (key === "first") (this as Map<unknown, unknown>).delete(key);
    return value;
  });
  deepStrictEqual(result, new Map([["second", 2]]));
});
