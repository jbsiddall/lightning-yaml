/**
 * Compat-shim unit tests (node:test) for src/js-yaml-compat.ts and
 * src/yaml-compat.ts. Run with:
 *   node --import tsx --test test/compat.unit.ts
 * or via:
 *   pnpm test:compat   (which runs bench/conformance/compat.ts, NOT this file —
 *                        see below)
 *
 * Named `*.unit.ts` (not `*.test.ts`) so vitest's glob (test/**\/*.test.ts)
 * ignores it, matching test/parser.unit.ts's convention. It now runs as part of
 * `pnpm test:unit` (alongside test/parser.unit.ts and test/adversarial.unit.ts),
 * and can also be run directly as above.
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
  type LoadOptions,
  type DumpOptions,
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
// Options: fail loud on anything not yet honoured (#91). The shims validate
// their option bag and THROW rather than silently ignoring an option they
// can't honour yet — so a relied-upon option surfaces at the call site instead
// of producing silently-wrong output. Each future option sub-task moves its key
// from this throw-list onto the honoured allowlist.
// --------------------------------------------------------------------------

test("js-yaml-compat.load/dump accept honoured no-op options", () => {
  deepStrictEqual(load("a: 1\n", { filename: "x.yaml" }), { a: 1 });
  deepStrictEqual(load("a: 1\n", { schema: CORE_SCHEMA }), { a: 1 });
  deepStrictEqual(load("a: 1\n", { json: true }), { a: 1 });
  // An explicit `undefined` value is treated as absent, like the real libraries.
  deepStrictEqual(load("a: 1\n", { schema: undefined, maxDepth: undefined }), { a: 1 });
  strictEqual(typeof dump(DUMP_VALUE, { schema: CORE_SCHEMA }), "string");
});

const LOAD_THROWS: ReadonlyArray<readonly [string, LoadOptions]> = [
  ["json:false", { json: false }],
  ["schema:JSON_SCHEMA", { schema: JSON_SCHEMA }],
  ["schema:YAML11_SCHEMA", { schema: YAML11_SCHEMA }],
  ["maxAliases", { maxAliases: 100 }],
  ["maxDepth", { maxDepth: 10 }],
  ["maxTotalMergeKeys", { maxTotalMergeKeys: 1 }],
];
for (const [label, opts] of LOAD_THROWS) {
  test(`js-yaml-compat.load throws YAMLException · ${label}`, () => {
    throws(() => load("a: 1\n", opts), (err: unknown) => err instanceof YAMLException);
  });
  test(`js-yaml-compat.loadAll throws YAMLException · ${label}`, () => {
    throws(() => loadAll("a: 1\n", null, opts), (err: unknown) => err instanceof YAMLException);
  });
}

test("js-yaml-compat.load throws on an unknown option key", () => {
  throws(
    () => load("a: 1\n", { nope: true } as unknown as LoadOptions),
    (err: unknown) => err instanceof YAMLException,
  );
});

test("js-yaml-compat.dump throws YAMLException on any real dump option", () => {
  for (const opts of [{ indent: 4 }, { sortKeys: true }, { noRefs: true }, { skipInvalid: true }] as DumpOptions[]) {
    throws(() => dump(DUMP_VALUE, opts), (err: unknown) => err instanceof YAMLException);
  }
});

test("js-yaml-compat: unsupported-option error names the option", () => {
  try {
    load("a: 1\n", { json: false });
    throw new Error("expected load() to throw");
  } catch (err) {
    ok(err instanceof YAMLException);
    ok((err as YAMLException).message.includes("json"));
  }
});

test("yaml-compat.parse/stringify accept honoured no-op options and the reviver", () => {
  deepStrictEqual(parse("a: 1\n", { schema: "core" }), { a: 1 });
  deepStrictEqual(parse("a: 1\n", { version: "1.2" }), { a: 1 });
  // The positional reviver still runs (it's honoured, not an option-bag key).
  deepStrictEqual(parse("a: 1\nb: 2\n", (k, v) => (k === "b" ? undefined : v)), { a: 1 });
  strictEqual(typeof stringify(DUMP_VALUE, { schema: "core" }), "string");
});

const PARSE_THROWS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["mapAsMap", { mapAsMap: true }],
  ["intAsBigInt", { intAsBigInt: true }],
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
  // falsy 2nd arg (`false`/`0`/`""`/`NaN` — e.g. a conditional `cond && opts` with `cond` false) means "no
  // options" and yields DEFAULT output, not an error. Verified live against real yaml@2.9.0. (This is the
  // reachable idiom the round-5 broadening regressed on, so it's locked here.)
  const def = stringify(DUMP_VALUE);
  for (const falsy of [false, 0, "", NaN] as unknown[]) {
    strictEqual(stringify(DUMP_VALUE, falsy as never), def);
    deepStrictEqual(yamlReal.parse(stringify(DUMP_VALUE, falsy as never)), DUMP_VALUE);
  }
});

test("yaml-compat.stringify tolerates an array in the 3rd-arg options slot (matches real yaml)", () => {
  // A 3-arg array in the options slot is spread-into-`{}`-and-ignored by real yaml (default output);
  // only a 2-arg array is a replacer (`stringify(v, [k])`), caught by the replacer guard above.
  strictEqual(stringify(DUMP_VALUE, null, [1, 2, 3]), stringify(DUMP_VALUE));
  deepStrictEqual(yamlReal.parse(stringify(DUMP_VALUE, null, [1, 2, 3])), DUMP_VALUE);
});

// --------------------------------------------------------------------------
// A bare scalar / array in the OPTIONS position is TOLERATED (no throw, default
// output) by parse/load/loadAll/dump — matching real yaml/js-yaml, which spread
// it into `{}` and proceed with defaults. (yaml.stringify is the sole exception:
// a scalar there is the indent shorthand it honours, so ours fails loud — see the
// indent-shorthand test above.) Regression guard: the shared options guard must
// not throw on a scalar, nor enumerate an array's indices as bogus option keys.
// --------------------------------------------------------------------------

test("yaml-compat.parse tolerates a scalar/array options arg (matches real yaml)", () => {
  deepStrictEqual(parse("a: 1\n", 4 as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", 4 as never));
  deepStrictEqual(parse("a: 1\n", [1, 2, 3] as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", [1, 2, 3] as never));
  // A falsy 2nd arg is "no options" too — the same truthy gate as stringify (behaviour-neutral for parse).
  deepStrictEqual(parse("a: 1\n", false as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", false as never));
  deepStrictEqual(parse("a: 1\n", 0 as unknown as Record<string, unknown>), yamlReal.parse("a: 1\n", 0 as never));
});

test("js-yaml-compat.load/loadAll/dump tolerate a scalar/array options arg (matches real js-yaml)", () => {
  deepStrictEqual(load("a: 1\n", 4 as unknown as LoadOptions), jsyamlReal.load("a: 1\n", 4 as never));
  deepStrictEqual(load("a: 1\n", [1] as unknown as LoadOptions), jsyamlReal.load("a: 1\n", [1] as never));
  // loadAll's 2-arg scalar form (scalar in the iterator slot) and its 3-arg options slot both tolerate it.
  deepStrictEqual(loadAll("a: 1\n", 4 as unknown as LoadOptions), jsyamlReal.loadAll("a: 1\n", 4 as never));
  deepStrictEqual(loadAll("a: 1\n", null, 4 as unknown as LoadOptions), jsyamlReal.loadAll("a: 1\n", null, 4 as never));
  deepStrictEqual(loadAll("a: 1\n", null, [1] as unknown as LoadOptions), jsyamlReal.loadAll("a: 1\n", null, [1] as never));
  // A nested value would expose a wrongly-honoured indent; js-yaml ignores the scalar/array, so each
  // tolerated call must equal the no-options call (both our hardcoded indent 2).
  const nested = { a: { b: 1 } };
  strictEqual(dump(nested, 4 as unknown as DumpOptions), dump(nested));
  strictEqual(dump(nested, [1] as unknown as DumpOptions), dump(nested));
  strictEqual(dump(nested, true as unknown as DumpOptions), dump(nested));
  strictEqual(dump(nested, "xy" as unknown as DumpOptions), dump(nested));
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

// --------------------------------------------------------------------------
// Options: overload / arg-shape coverage. The option bag must be validated
// whichever legal positional shape the caller uses — an options bag passed in a
// middle/omitted slot slipping past validation would silently reintroduce the
// exact divergence this feature exists to prevent.
// --------------------------------------------------------------------------

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

test("js-yaml-compat.loadAll validates options passed as the 2nd argument", () => {
  // js-yaml's own loadAll(input, options) overload — no iterator
  throws(() => loadAll("a: 1\n", { maxDepth: 5 }), (err: unknown) => err instanceof YAMLException);
  // iterator + options (3rd slot) still validates
  throws(() => loadAll("a: 1\n", () => {}, { maxDepth: 5 }), (err: unknown) => err instanceof YAMLException);
  // the plain iterator form still works
  const seen: unknown[] = [];
  loadAll("---\na: 1\n---\nb: 2\n", (d) => seen.push(d));
  deepStrictEqual(seen, [{ a: 1 }, { b: 2 }]);
});

test("js-yaml-compat.loadAll resolves its options overload 2nd-arg-wins (opposite of yaml parse/stringify)", () => {
  // js-yaml is 2ND-ARG-WINS — an object 2nd arg IS the options bag and silently discards the 3rd — the
  // OPPOSITE of yaml-compat.ts's parse/stringify (3rd-arg-wins). So an unsupported option in the 3rd slot
  // is IGNORED when a valid object 2nd arg is present: `loadAll("a: 1", {json:true}, {maxDepth:1})` does
  // NOT throw (the `maxDepth` never runs), matching real js-yaml@5.2.1. If someone "DRY"s loadAll to
  // 3rd-arg-wins, `maxDepth:1` would win and throw, and this fails.
  deepStrictEqual(loadAll("a: 1", { json: true }, { maxDepth: 1 }), [{ a: 1 }]);
  deepStrictEqual(loadAll("a: 1", { json: true }, { maxDepth: 1 }), jsyamlReal.loadAll("a: 1", { json: true } as never, { maxDepth: 1 } as never));
});

// --------------------------------------------------------------------------
// Options: an option's genuine no-op default value is accepted ("accept only
// true no-op values"), while the feature-activating value throws.
// --------------------------------------------------------------------------

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

test("js-yaml-compat.dump accepts a boolean option's no-op default, rejects the active value", () => {
  strictEqual(typeof dump(DUMP_VALUE, { sortKeys: false }), "string");
  strictEqual(typeof dump(DUMP_VALUE, { noRefs: false }), "string");
  throws(() => dump(DUMP_VALUE, { sortKeys: true }), (err: unknown) => err instanceof YAMLException);
});

test("js-yaml-compat.dump throws on skipInvalid at either value (we neither drop nor throw on unrepresentable values)", () => {
  // Real js-yaml's `skipInvalid: false` THROWS on a function/Symbol; our stringify would
  // silently serialize it — so `false` is NOT a genuine no-op. Both values fail loud.
  throws(() => dump(DUMP_VALUE, { skipInvalid: false }), (err: unknown) => err instanceof YAMLException);
  throws(() => dump(DUMP_VALUE, { skipInvalid: true }), (err: unknown) => err instanceof YAMLException);
});
