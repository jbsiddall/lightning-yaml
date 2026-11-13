/**
 * Unit tests for the js-yaml compatibility shim.
 * Run with: node --import tsx --test test/js-yaml-compat.unit.ts
 */

import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws, ok } from "node:assert";
import * as jsyamlReal from "js-yaml";
import jsYamlCompatDefault, {
  load, loadAll, dump, YAMLException, defineScalarTag, Schema, YAML11_SCHEMA, CORE_SCHEMA, JSON_SCHEMA, FAILSAFE_SCHEMA,
  type LoadOptions, type DumpOptions,
} from "../src/js-yaml-compat.ts";
import { parse as coreParse } from "../src/core.ts";

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
}

const MULTI_DOC = "---\na: 1\n---\nb: 2\n---\nc: 3\n";
const DUMP_VALUE = { name: "svc", replicas: 3, enabled: true, tags: ["a", "b"] };
const MALFORMED = "a: [1, 2\n";

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

test("js-yaml-compat.loadAll matches real js-yaml.loadAll on a multi-doc stream", () => {
  deepStrictEqual(loadAll(MULTI_DOC), jsyamlReal.loadAll(MULTI_DOC));
});

test("js-yaml-compat.loadAll with an iterator callback works (returns undefined, invokes per-doc)", () => {
  const seen: unknown[] = [];
  const result = loadAll(MULTI_DOC, (doc) => seen.push(doc));
  strictEqual(result, undefined);
  deepStrictEqual(seen, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test("js-yaml-compat.load rejects streams without a document like js-yaml 5.4.3", () => {
  const emptyStreams = [
    "", " ", "\n", "\r\n", "\t\r\n", "# comment", "# comment\r\n",
    "\ufeff", "\ufeff# comment\r\n", "...", "...\n...",
    "... # c\r\n# tail\r\n...\r\n",
  ];
  for (const input of emptyStreams) {
    throws(() => jsyamlReal.load(input), (err: unknown) => {
      ok(err instanceof jsyamlReal.YAMLException);
      strictEqual((err as YAMLException).reason, "expected a document, but the input is empty");
      return true;
    });
    throws(() => load(input), (err: unknown) => {
      ok(err instanceof YAMLException);
      strictEqual((err as YAMLException).reason, "expected a document, but the input is empty");
      return true;
    });
    deepStrictEqual(jsyamlReal.loadAll(input), []);
    deepStrictEqual(loadAll(input), []);
    const seen: unknown[] = [];
    strictEqual(loadAll(input, (doc) => { seen.push(doc); }), undefined);
    deepStrictEqual(seen, []);
  }
});

test("js-yaml-compat.load preserves explicit null documents and loadAll overload effects", () => {
  for (const input of ["---", "---\n# c\n", "---\n...\n...", "%YAML 1.2\n---", "null", "~"]) {
    strictEqual(load(input), jsyamlReal.load(input));
    strictEqual(load(input), null);
    deepStrictEqual(loadAll(input), [null]);
    for (const call of [
      () => loadAll(input, { json: true }),
      () => loadAll(input, null, { json: true }),
      () => loadAll(input, undefined, { json: true }),
    ]) deepStrictEqual(call(), [null]);
    const seen: unknown[] = [];
    strictEqual(loadAll(input, (doc) => { seen.push(doc); }, { json: true }), undefined);
    deepStrictEqual(seen, [null]);
  }
  throws(() => load("", { maxDepth: 1 } as LoadOptions), /maxDepth/);
});

test("js-yaml-compat.load rejection preserves parser state and filename marks", () => {
  throws(() => load("", { filename: "empty.yml" }), (err: unknown) => {
    ok(err instanceof YAMLException);
    strictEqual((err as YAMLException).reason, "expected a document, but the input is empty");
    strictEqual((err as YAMLException).mark.name, "empty.yml");
    return true;
  });
  deepStrictEqual(coreParse("\tbad: value\n"), { "bad": "value" });
  throws(() => coreParse("\tbad: value\n", { strict: true }), /tab/);
  deepStrictEqual(load("a: 1\n"), { a: 1 });

  for (const input of ["--- first\n--- second\n", "[\n"]) {
    throws(() => load(input, { filename: "bad.yml" }), (err: unknown) => {
      ok(err instanceof YAMLException);
      strictEqual((err as YAMLException).mark.name, "bad.yml");
      return true;
    });
    deepStrictEqual(load("after: failure\n"), { after: "failure" });
  }

  const seen: unknown[] = [];
  loadAll("first\n...\nsecond", (doc) => {
    seen.push(doc);
    throws(() => load(""), YAMLException);
    deepStrictEqual(coreParse("a: 1\n", { optimizations: { internStrings: true } }), { a: 1 });
  });
  deepStrictEqual(seen, ["first", "second"]);
  deepStrictEqual(coreParse("ordinary: value\n"), { ordinary: "value" });
});

test("js-yaml-compat.loadAll validates every document before callbacks", () => {
  const input = "--- first\n...\n--- [\n";
  for (const parseAll of [jsyamlReal.loadAll, loadAll]) {
    const seen: unknown[] = [];
    throws(() => parseAll(input, (doc) => { seen.push(doc); }),
      parseAll === jsyamlReal.loadAll ? jsyamlReal.YAMLException : YAMLException);
    deepStrictEqual(seen, []);
  }
});

test("js-yaml-compat document counting preserves marker-like content and validates syntax", () => {
  const contentCases = [
    ["---x", "---x"],
    ["...x", "...x"],
    ["{a: 1}", { a: 1 }],
    ['""', ""],
    ["\ufeff\ufeff", "\ufeff"],
  ] as const;
  for (const [input, expected] of contentCases) {
    deepStrictEqual(jsyamlReal.load(input), expected);
    deepStrictEqual(load(input), expected);
    deepStrictEqual(jsyamlReal.loadAll(input), [expected]);
    deepStrictEqual(loadAll(input), [expected]);
  }

  for (const input of ["[", "%YAML 1.2\n", "%TAG !e! tag:example.com,2020:\n"]) {
    throws(() => jsyamlReal.load(input), jsyamlReal.YAMLException);
    throws(() => load(input), YAMLException);
    throws(() => jsyamlReal.loadAll(input), jsyamlReal.YAMLException);
    throws(() => loadAll(input), YAMLException);
    const seen: unknown[] = [];
    throws(() => loadAll(input, (doc) => { seen.push(doc); }), YAMLException);
    deepStrictEqual(seen, []);
  }

  const multiple = "---\n---";
  throws(() => jsyamlReal.load(multiple), jsyamlReal.YAMLException);
  throws(() => load(multiple), YAMLException);
  deepStrictEqual(jsyamlReal.loadAll(multiple), [null, null]);
  deepStrictEqual(loadAll(multiple), [null, null]);
  const seen: unknown[] = [];
  strictEqual(loadAll(multiple, (doc) => { seen.push(doc); }), undefined);
  deepStrictEqual(seen, [null, null]);
});

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

test("js-yaml-compat.dump emits YAML the real js-yaml reads back", () => {
  const text = dump(DUMP_VALUE);
  strictEqual(typeof text, "string");
  deepStrictEqual(jsyamlReal.load(text), DUMP_VALUE);
});

test("js-yaml-compat.load/dump accept honoured no-op options", () => {
  deepStrictEqual(load("a: 1\n", { filename: "x.yaml" }), { a: 1 });
  deepStrictEqual(load("a: 1\n", { schema: CORE_SCHEMA }), { a: 1 });
  deepStrictEqual(load("a: 1\n", { json: true }), { a: 1 });
  // An explicit `undefined` value is treated as absent, like the real libraries.
  deepStrictEqual(load("a: 1\n", { schema: undefined, maxDepth: undefined }), { a: 1 });
  strictEqual(typeof dump(DUMP_VALUE, { schema: CORE_SCHEMA }), "string");
});

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
  // loadAll's 2ND-ARG-WINS overload resolution (the opposite of yaml-compat.ts's 3rd-arg-wins) is spelled
  // out in loadAll's own comment (src/js-yaml-compat.ts). What THIS test locks: a valid object 2nd arg
  // silently discards an unsupported 3rd-arg option — `loadAll("a: 1", {json:true}, {maxDepth:1})` does
  // NOT throw — so a "DRY" refactor toward 3rd-arg-wins would make `maxDepth:1` win and throw, failing here.
  deepStrictEqual(loadAll("a: 1", { json: true }, { maxDepth: 1 }), [{ a: 1 }]);
  deepStrictEqual(loadAll("a: 1", { json: true }, { maxDepth: 1 }), jsyamlReal.loadAll("a: 1", { json: true } as never, { maxDepth: 1 } as never));
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
