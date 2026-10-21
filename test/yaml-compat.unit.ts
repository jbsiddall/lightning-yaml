/**
 * Unit tests for the yaml compatibility shim.
 * Run with: node --import tsx --test test/yaml-compat.unit.ts
 */

import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws, ok } from "node:assert";
import * as yamlReal from "yaml";
import yamlCompatDefault, { parse, parseAllDocuments, parseDocument, stringify } from "../src/yaml-compat.ts";
import { parse as coreParse, parseAll as coreParseAll, requiredDocumentOptions, yamlDocumentOptions } from "../src/core.ts";
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
  strictEqual(typeof yamlCompatDefault.Composer, "function");
  strictEqual(typeof yamlCompatDefault.Document, "function");
  strictEqual(typeof yamlCompatDefault.YAMLMap, "function");
  strictEqual(typeof yamlCompatDefault.isNode, "function");
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
  ok(doc.contents && typeof doc.contents === "object" && "items" in doc.contents);
  deepStrictEqual(doc.errors, []);
  deepStrictEqual(doc.warnings, []);
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
    strictEqual(docs.length, input.startsWith("---") ? 3 : 2);
    strictEqual(docs[0].toJS(), null);
    const partial = docs.at(-1)!;
    ok(partial.contents instanceof Object);
    ok(partial.errors.some((error) => error.code === "MISSING_CHAR"));
    const document = parseDocument(input);
    strictEqual(document.toJS(), null);
    ok(document.errors.some((error) => error.code === "MULTIPLE_DOCS"));
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
