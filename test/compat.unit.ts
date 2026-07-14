/**
 * Compat-shim unit tests (node:test) for src/js-yaml-compat.ts and
 * src/yaml-compat.ts. Run with:
 *   node --import tsx --test test/compat.unit.ts
 * or via:
 *   pnpm test:compat   (which runs bench/conformance/compat.ts, NOT this file —
 *                        see below)
 *
 * Named `*.unit.ts` (not `*.test.ts`) so vitest's glob (test/**\/*.test.ts)
 * ignores it, matching test/parser.unit.ts's convention. It is NOT part of
 * `pnpm test:unit` either (that command targets only test/parser.unit.ts by
 * name) — run this file directly, as above.
 *
 * Scope: this file asserts things that SHOULD PASS TODAY — the shim's API
 * surface is wired correctly and the constructs our parser already handles
 * (M0-M3 + M5: plain/quoted scalars, flow/block collections, multi-doc
 * streams) come back identical to the real libraries. It deliberately does
 * NOT assert the known-red gaps (block scalars, anchors/aliases, tags, merge
 * keys, js-yaml-1.1-isms) — those are tracked with counts and examples by the
 * differential report, bench/conformance/compat.ts (`pnpm test:compat`).
 */

import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws, ok } from "node:assert";
import * as jsyamlReal from "js-yaml";
import * as yamlReal from "yaml";
import jsYamlCompatDefault, {
  load,
  loadAll,
  dump,
  YAMLException,
  defineScalarTag,
  Schema,
  YAML11_SCHEMA,
  CORE_SCHEMA,
  JSON_SCHEMA,
  FAILSAFE_SCHEMA,
} from "../src/js-yaml-compat.ts";
import yamlCompatDefault, { parse, parseAllDocuments, parseDocument, stringify } from "../src/yaml-compat.ts";

// --------------------------------------------------------------------------
// API surface — named + default exports resolve to the right shapes.
// --------------------------------------------------------------------------

test("js-yaml-compat: named exports exist with the right shapes", () => {
  strictEqual(typeof load, "function");
  strictEqual(typeof loadAll, "function");
  strictEqual(typeof dump, "function");
  strictEqual(typeof YAMLException, "function"); // a class
  ok(new YAMLException("x") instanceof Error);
  strictEqual(typeof defineScalarTag, "function");
  strictEqual(typeof Schema, "function");
  ok(YAML11_SCHEMA instanceof Schema);
  ok(CORE_SCHEMA instanceof Schema);
  ok(JSON_SCHEMA instanceof Schema);
  ok(FAILSAFE_SCHEMA instanceof Schema);
});

test("js-yaml-compat: default export object mirrors the named exports", () => {
  strictEqual(jsYamlCompatDefault.load, load);
  strictEqual(jsYamlCompatDefault.loadAll, loadAll);
  strictEqual(jsYamlCompatDefault.dump, dump);
  strictEqual(jsYamlCompatDefault.YAMLException, YAMLException);
  deepStrictEqual(jsYamlCompatDefault.load("a: 1\n"), { a: 1 });
});

test("yaml-compat: named exports exist with the right shapes", () => {
  strictEqual(typeof parse, "function");
  strictEqual(typeof parseAllDocuments, "function");
  strictEqual(typeof parseDocument, "function");
  strictEqual(typeof stringify, "function");
});

test("yaml-compat: default export object mirrors the named exports", () => {
  strictEqual(yamlCompatDefault.parse, parse);
  strictEqual(yamlCompatDefault.parseAllDocuments, parseAllDocuments);
  strictEqual(yamlCompatDefault.parseDocument, parseDocument);
  strictEqual(yamlCompatDefault.stringify, stringify);
  deepStrictEqual(yamlCompatDefault.parse("a: 1\n"), { a: 1 });
});

// --------------------------------------------------------------------------
// Basic documents parse identically to the real libraries.
// --------------------------------------------------------------------------

const basicDocs = [
  ["plain map", "a: 1\nb: two\nc: true\n"],
  ["sequence", "- 1\n- 2\n- 3\n"],
  ["nested block map", "a:\n  b:\n    c: 1\n  d: 2\ne: 3\n"],
  ["flow map", "{a: 1, b: [2, 3], c: {d: 4}}"],
] as const;

for (const [label, text] of basicDocs) {
  test(`js-yaml-compat.load matches real js-yaml.load · ${label}`, () => {
    deepStrictEqual(load(text), jsyamlReal.load(text));
  });

  test(`yaml-compat.parse matches real yaml.parse · ${label}`, () => {
    deepStrictEqual(parse(text), yamlReal.parse(text));
  });
}

// --------------------------------------------------------------------------
// Multi-document streams.
// --------------------------------------------------------------------------

const MULTI_DOC = "---\na: 1\n---\nb: 2\n---\nc: 3\n";

test("js-yaml-compat.loadAll matches real js-yaml.loadAll on a multi-doc stream", () => {
  deepStrictEqual(loadAll(MULTI_DOC), jsyamlReal.loadAll(MULTI_DOC));
});

test("js-yaml-compat.loadAll with an iterator callback works (returns undefined, invokes per-doc)", () => {
  const seen: unknown[] = [];
  const result = loadAll(MULTI_DOC, (doc) => seen.push(doc));
  strictEqual(result, undefined);
  deepStrictEqual(seen, [{ a: 1 }, { b: 2 }, { c: 3 }]);
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
  deepStrictEqual(doc.contents, { a: 1, b: 2 });
  deepStrictEqual(doc.errors, []);
  deepStrictEqual(doc.warnings, []);
});

// --------------------------------------------------------------------------
// Errors — a malformed document surfaces as a YAMLException from
// js-yaml-compat (per the HARD CONSTRAINTS: our own YAMLParseError is caught
// and rethrown as YAMLException, so `catch (e) { e instanceof YAMLException }`
// works the same way it would against real js-yaml).
// --------------------------------------------------------------------------

const MALFORMED = "a: [1, 2\n"; // unterminated flow sequence

test("js-yaml-compat.load throws YAMLException on malformed input", () => {
  throws(() => load(MALFORMED), (err: unknown) => err instanceof YAMLException);
});

test("js-yaml-compat.loadAll throws YAMLException on malformed input", () => {
  throws(() => loadAll(MALFORMED), (err: unknown) => err instanceof YAMLException);
});

test("YAMLException carries name/reason/message/mark like js-yaml's", () => {
  try {
    load(MALFORMED);
    throw new Error("expected load() to throw");
  } catch (err) {
    ok(err instanceof YAMLException);
    const e = err as YAMLException;
    strictEqual(e.name, "YAMLException");
    strictEqual(typeof e.reason, "string");
    strictEqual(typeof e.message, "string");
    ok(e.mark && typeof e.mark.line === "number" && typeof e.mark.column === "number");
  }
});

// --------------------------------------------------------------------------
// dump/stringify delegate to our implemented stringify() (M6): they emit YAML
// that round-trips through the REAL library — the drop-in contract. They used
// to throw NotImplementedError; the dumper closed that gap, so we now assert
// the working behavior directly.
// --------------------------------------------------------------------------

// Deliberately free of YAML-1.1-ambiguous tokens (yes/no/on/off) so the
// round-trip is schema-agnostic across both real libraries.
const DUMP_VALUE = { name: "svc", replicas: 3, enabled: true, tags: ["a", "b"] };

test("js-yaml-compat.dump emits YAML the real js-yaml reads back", () => {
  const text = dump(DUMP_VALUE);
  strictEqual(typeof text, "string");
  deepStrictEqual(jsyamlReal.load(text), DUMP_VALUE);
});

test("yaml-compat.stringify emits YAML the real yaml reads back", () => {
  const text = stringify(DUMP_VALUE);
  strictEqual(typeof text, "string");
  deepStrictEqual(yamlReal.parse(text), DUMP_VALUE);
});
