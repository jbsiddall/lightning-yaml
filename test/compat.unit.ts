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

// --------------------------------------------------------------------------
// load/loadAll options — schema (core vs rich typing), maxAliases, maxDepth.
// These wire LoadOptions through to the core parser (src/index.ts). `filename`
// is exercised by the YAMLException test above (it threads into mark.name).
// --------------------------------------------------------------------------

const BINARY_DOC = "x: !!binary QUJD\n"; // base64 "ABC"
const SET_DOC = "x: !!set\n  ? a\n  ? b\n";

test("schema: CORE_SCHEMA rejects rich tags the way real js-yaml does", () => {
  // Real js-yaml v5's default (= core) throws "unknown ... tag" on these.
  throws(() => jsyamlReal.load(BINARY_DOC, { schema: jsyamlReal.CORE_SCHEMA }), (e: unknown) => e instanceof Error);
  throws(() => load(BINARY_DOC, { schema: CORE_SCHEMA }), (e: unknown) => e instanceof YAMLException && /unknown scalar tag/.test(e.message));
  throws(() => load(SET_DOC, { schema: CORE_SCHEMA }), (e: unknown) => e instanceof YAMLException && /unknown mapping tag/.test(e.message));
  // JSON_SCHEMA / FAILSAFE_SCHEMA behave the same (all reject the rich tags).
  throws(() => load(BINARY_DOC, { schema: JSON_SCHEMA }), (e: unknown) => e instanceof YAMLException);
  throws(() => load(BINARY_DOC, { schema: FAILSAFE_SCHEMA }), (e: unknown) => e instanceof YAMLException);
});

test("schema: YAML11_SCHEMA resolves rich tags (binary→Uint8Array, set→Set), matching real js-yaml", () => {
  const real = jsyamlReal.load(BINARY_DOC, { schema: jsyamlReal.YAML11_SCHEMA }) as { x: Uint8Array };
  const ours = load(BINARY_DOC, { schema: YAML11_SCHEMA }) as { x: Uint8Array };
  ok(ours.x instanceof Uint8Array);
  deepStrictEqual(Array.from(ours.x), Array.from(real.x));

  const realSet = jsyamlReal.load(SET_DOC, { schema: jsyamlReal.YAML11_SCHEMA }) as { x: Set<string> };
  const oursSet = load(SET_DOC, { schema: YAML11_SCHEMA }) as { x: Set<string> };
  ok(oursSet.x instanceof Set);
  deepStrictEqual([...oursSet.x].sort(), [...realSet.x].sort());
});

test("schema: default (no option) keeps lightning-yaml's rich resolution", () => {
  // Documented divergence from real js-yaml (whose load default is core): our
  // default is rich, matching our own parse(). CORE_SCHEMA is the opt-in to strict.
  const ours = load(BINARY_DOC) as { x: Uint8Array };
  ok(ours.x instanceof Uint8Array);
});

const BILLION_LAUGHS = "a: &a [1]\nb: &b [*a, *a, *a]\nc: [*b, *b, *b]\n";

test("maxAliases caps resolved aliases (and default is uncapped)", () => {
  deepStrictEqual(load(BILLION_LAUGHS), jsyamlReal.load(BILLION_LAUGHS)); // uncapped default agrees
  throws(() => load(BILLION_LAUGHS, { maxAliases: 2 }), (e: unknown) => e instanceof YAMLException && /maxAliases/.test(e.message));
  throws(() => jsyamlReal.load(BILLION_LAUGHS, { maxAliases: 2 }), (e: unknown) => e instanceof Error); // real js-yaml agrees it throws
});

const NESTED_DOC = "a:\n  b:\n    c:\n      d: 1\n";

test("maxDepth caps nesting depth (and default parses deep docs)", () => {
  deepStrictEqual(load(NESTED_DOC), { a: { b: { c: { d: 1 } } } });
  throws(() => load(NESTED_DOC, { maxDepth: 2 }), (e: unknown) => e instanceof YAMLException);
  throws(() => jsyamlReal.load(NESTED_DOC, { maxDepth: 2 }), (e: unknown) => e instanceof Error); // real js-yaml agrees it throws
});

// --------------------------------------------------------------------------
// dump options — indent, quoteStyle, forceQuotes, noRefs, schema. We assert
// against the REAL js-yaml where 1.2 output agrees; where js-yaml applies a
// 1.1-ism (e.g. quoting a bare `n` key) we assert round-trip structure instead,
// since lightning-yaml is deliberately 1.2-only.
// --------------------------------------------------------------------------

test("dump: indent sets the block indent width", () => {
  strictEqual(dump({ a: { b: 1 } }, { indent: 4 }), "a:\n    b: 1\n");
  strictEqual(dump({ a: { b: 1 } }, { indent: 4 }), jsyamlReal.dump({ a: { b: 1 } }, { indent: 4 }));
  strictEqual(dump({ a: { b: 1 } }, { indent: 1 }), "a:\n b: 1\n");
});

test("dump: forceQuotes quotes string values (keys/numbers left alone)", () => {
  strictEqual(dump({ a: "hello", n: 1 }, { forceQuotes: true }), "a: 'hello'\nn: 1\n");
});

test("dump: quoteStyle picks the quote character when quoting", () => {
  strictEqual(dump({ a: "x y" }, { forceQuotes: true, quoteStyle: "double" }), 'a: "x y"\n');
  strictEqual(dump({ a: "x y" }, { forceQuotes: true, quoteStyle: "single" }), "a: 'x y'\n");
});

test("dump: noRefs duplicates shared nodes and round-trips to a deep copy", () => {
  const shared = { n: 1 };
  const value = { a: shared, b: shared };
  const withRefs = dump(value); // default anchors the shared node
  ok(/[&*]/.test(withRefs));
  const noRefs = dump(value, { noRefs: true });
  ok(!/[&*]/.test(noRefs));
  deepStrictEqual(jsyamlReal.load(noRefs), { a: { n: 1 }, b: { n: 1 } });
});

test("dump: noRefs throws on a genuine cycle instead of looping", () => {
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  throws(() => dump(cyc, { noRefs: true }), (e: unknown) => e instanceof Error && /circular/.test(e.message));
  ok(/[&*]/.test(dump(cyc))); // default (anchors) still serializes the cycle
});

test("dump: schema core rejects a Uint8Array; rich/default emits !!binary", () => {
  const val = { b: new Uint8Array([1, 2]) };
  throws(() => dump(val, { schema: CORE_SCHEMA }), (e: unknown) => e instanceof Error);
  strictEqual(dump(val), "b: !!binary AQI=\n");
  strictEqual(dump(val, { schema: YAML11_SCHEMA }), "b: !!binary AQI=\n");
});

test("dump: passing no options is byte-identical to bare stringify", () => {
  const val = { name: "svc", replicas: 3, list: ["a", "b"], nested: { x: 1 } };
  strictEqual(dump(val), stringify(val));
});

// --------------------------------------------------------------------------
// Regression guards for defects found in adversarial review.
// --------------------------------------------------------------------------

test("dump: a fractional indent is floored, not corrupted (was: emitted literal 'undefined')", () => {
  const out = dump({ a: { b: 1 } }, { indent: 2.5 });
  ok(!out.includes("undefined"));
  strictEqual(out, "a:\n  b: 1\n"); // floor(2.5) === 2
  strictEqual(dump({ a: { b: 1 } }, { indent: 3.9 }), jsyamlReal.dump({ a: { b: 1 } }, { indent: 3.9 })); // both floor to 3
});

test("loadAll: maxAliases is counted per document, not across the whole stream", () => {
  const stream = "---\nr: &a 1\nx: [*a, *a]\n---\nr: &b 1\ny: [*b, *b]\n"; // 2 aliases per doc
  // Each document is within maxAliases:3; the accumulated 4 must NOT trip it (matches js-yaml).
  deepStrictEqual(loadAll(stream, null, { maxAliases: 3 }), jsyamlReal.loadAll(stream, null, { maxAliases: 3 }));
  // A single document that really exceeds the per-doc cap still throws.
  throws(() => loadAll("r: &a 1\nx: [*a, *a, *a, *a]\n", null, { maxAliases: 3 }), (e: unknown) => e instanceof YAMLException);
});

test("maxDepth: the throw boundary matches js-yaml (root counts as depth 1)", () => {
  const threeDeep = "a:\n  b:\n    c: 1\n"; // 3 nested maps
  throws(() => load(threeDeep, { maxDepth: 3 }), (e: unknown) => e instanceof YAMLException);
  throws(() => jsyamlReal.load(threeDeep, { maxDepth: 3 }), (e: unknown) => e instanceof Error);
  deepStrictEqual(load(threeDeep, { maxDepth: 4 }), { a: { b: { c: 1 } } });
  deepStrictEqual(jsyamlReal.load(threeDeep, { maxDepth: 4 }), { a: { b: { c: 1 } } });
});
