import { test } from "node:test";
import { deepStrictEqual, equal, notEqual, ok, strictEqual, throws } from "node:assert/strict";
import jsYamlDefault, {
  CORE_SCHEMA,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  YAML11_SCHEMA,
  Schema,
  YAMLException,
  defineMappingTag,
  defineScalarTag,
  defineSequenceTag,
  load,
  loadAll,
} from "../src/js-yaml-compat.ts";
import { parse, parseDocument, stringify } from "../src/yaml-compat.ts";

test("yaml reviver visits descendants first, then properties, then the synthetic root with holder this", () => {
  const calls: Array<[string, unknown, unknown]> = [];
  const result = parse('{"a":[1,2],"b":{"c":3}}', function (this: unknown, key, value) {
    calls.push([key, value, this]);
    return value;
  });
  deepStrictEqual(calls.map(([key]) => key), ["0", "1", "a", "c", "b", ""]);
  strictEqual(calls[0][2], (result as Record<string, unknown>).a);
  strictEqual(calls.at(-1)?.[2] && (calls.at(-1)?.[2] as Record<string, unknown>)[""], result);
  strictEqual(calls.at(-1)?.[1], result);
});

test("yaml reviver reads array length live and calls holes with undefined", () => {
  const keys: string[] = [];
  const visitedHoles: Array<[string, unknown]> = [];
  const value = parse("[1,2]", function (this: unknown, key, child) {
    keys.push(key);
    if (key === "0") {
      const array = this as unknown[];
      delete array[1];
      array.push(3);
      return undefined;
    }
    if (key === "1") visitedHoles.push([key, child]);
    return child;
  }) as unknown[];
  deepStrictEqual(keys, ["0", "1", "2", ""]);
  deepStrictEqual(visitedHoles, [["1", undefined]]);
  equal(value.length, 3);
  equal(0 in value, false);
  equal(1 in value, false);
  equal(value[2], 3);
});

test("yaml reviver observes its .call getter and preserves thrown sentinel identity", () => {
  let gets = 0;
  const reviver = function (this: unknown, _key: string, value: unknown) { return value; } as ((key: string, value: unknown) => unknown) & { call: Function };
  Object.defineProperty(reviver, "call", {
    configurable: true,
    get() { gets += 1; return Function.prototype.call; },
  });
  deepStrictEqual(parse("1", reviver), 1);
  equal(gets, 1); // a scalar has only the synthetic-root call

  const sentinel = { marker: "reviver" };
  throws(() => parse("1", () => { throw sentinel; }), (error) => error === sentinel);
  const seen: string[] = [];
  const original = function (this: unknown, key: string, value: unknown) { seen.push(key); return value; } as ((key: string, value: unknown) => unknown) & { call: Function };
  original.call = function (this: unknown, holder: unknown, key: string, value: unknown) {
    seen.push(`call:${key}`);
    return Function.prototype.call.call(original, holder, key, value);
  };
  parse("1", original);
  deepStrictEqual(seen, ["call:", ""]);
});

test("js-yaml loadAll parses the whole stream before callbacks and stops on the original callback error", () => {
  const callbacks: unknown[] = [];
  throws(() => loadAll("a: 1\n---\nb: [\n", (doc) => callbacks.push(doc)), (error) => error instanceof YAMLException);
  deepStrictEqual(callbacks, []);

  const validationCallbacks: unknown[] = [];
  throws(() => loadAll("a: 1\n", (doc) => validationCallbacks.push(doc), { maxDepth: 1 }), (error) => error instanceof YAMLException);
  deepStrictEqual(validationCallbacks, []); // option validation also precedes callback invocation

  let callbackThis: unknown = "not-called";
  const strictCallback = function (this: void, _doc: unknown) { callbackThis = this; };
  const result = loadAll("a: 1\n---\nb: 2\n", strictCallback);
  strictEqual(result, undefined);
  strictEqual(callbackThis, undefined);

  const sentinel = { marker: "iterator" };
  const visited: unknown[] = [];
  throws(() => loadAll("a: 1\n---\nb: 2\n---\nc: 3\n", (doc) => {
    visited.push(doc);
    if (visited.length === 1) throw sentinel;
  }), (error) => error === sentinel);
  deepStrictEqual(visited, [{ a: 1 }]);
});

test("yaml document methods capture original contents and expose fresh mutable arrays and ordinary descriptors", () => {
  const first = parseDocument("a: 1\n");
  const second = parseDocument("b: 2\n");
  const original = first.contents;
  first.contents = { replaced: true };
  strictEqual(first.toJS(), original);
  strictEqual(first.toJSON(), original);
  notEqual(first.errors, first.warnings);
  notEqual(first.errors, second.errors);
  notEqual(first.warnings, second.warnings);
  for (const key of ["contents", "errors", "warnings", "toJS", "toJSON"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(first, key);
    ok(descriptor);
    deepStrictEqual({ writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable }, {
      writable: true, enumerable: true, configurable: true,
    });
  }
});

test("tag factories ignore options getters and preserve tagName values without coercion", () => {
  const sentinel = { raw: true };
  const options = Object.defineProperty({}, "any", { get() { throw new Error("options must not be read"); } });
  for (const [factory, kind] of [
    [defineScalarTag, "scalar"], [defineSequenceTag, "sequence"], [defineMappingTag, "mapping"],
  ] as const) {
    const definition = factory(sentinel as unknown as string, options);
    strictEqual(definition.tagName as unknown, sentinel);
    strictEqual(definition.nodeKind, kind);
  }
});

test("Schema.withTags uses its receiver and schema singleton identities stay distinct", () => {
  const receiver = { marker: "receiver" };
  strictEqual((Schema.prototype.withTags as unknown as (this: unknown, ...tags: unknown[]) => unknown).call(receiver, {}), receiver);
  equal(new Set([FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, YAML11_SCHEMA]).size, 4);

  const compat = jsYamlDefault;
  const original = compat.CORE_SCHEMA;
  const replacement = new Schema();
  try {
    compat.CORE_SCHEMA = replacement;
    deepStrictEqual(load("a: 1\n", { schema: original }), { a: 1 });
    throws(() => load("a: 1\n", { schema: replacement }), (error) => error instanceof YAMLException);
  } finally {
    compat.CORE_SCHEMA = original;
  }
});

test("YAMLException keeps raw reason and mark identity, defaults independently, and observes getters in order", () => {
  const mark = { buffer: "b", column: 1, line: 2, name: "n", position: 3, snippet: "s" };
  const supplied = new YAMLException("reason", mark);
  strictEqual(supplied.reason, "reason");
  equal(supplied.message, "reason");
  supplied.reason = "changed reason";
  equal(supplied.message, "reason");
  strictEqual(supplied.mark, mark);
  const rawReason = { message: "raw" };
  strictEqual(new YAMLException(rawReason as unknown as string).reason as unknown, rawReason);
  const one = new YAMLException();
  const two = new YAMLException();
  equal(one.reason, "unknown reason");
  notEqual(one.mark, two.mark);
  one.mark.line = 4;
  equal(two.mark.line, 0);

  const reads: string[] = [];
  const nameValue = { [Symbol.toPrimitive]() { reads.push("coerce-name"); return "Observed"; } };
  const messageValue = { [Symbol.toPrimitive]() { reads.push("coerce-message"); return "detail"; } };
  Object.defineProperty(supplied, "name", { configurable: true, get() { reads.push("get-name"); return nameValue; } });
  Object.defineProperty(supplied, "message", { configurable: true, get() { reads.push("get-message"); return messageValue; } });
  equal(supplied.toString(), "Observed: detail");
  deepStrictEqual(reads, ["get-name", "coerce-name", "get-message", "coerce-message"]);
  reads.length = 0;
  Object.defineProperty(supplied, "name", { configurable: true, get() { reads.push("get-name-symbol"); return Symbol("name"); } });
  throws(() => supplied.toString(), TypeError);
  deepStrictEqual(reads, ["get-name-symbol"]); // failed coercion prevents the message getter read
  throws(() => (YAMLException as unknown as () => YAMLException)(), TypeError);
});

test("option observation order, undefined skipping, validation-before-replacer, and thrown getter identity are preserved", () => {
  const accesses: string[] = [];
  const opts = {
    get prettyErrors() { accesses.push("prettyErrors"); return undefined; },
    get unknownUndefined() { accesses.push("unknownUndefined"); return undefined; },
    get mapAsMap() { accesses.push("mapAsMap"); return false; },
    get uniqueKeys() { accesses.push("uniqueKeys"); return true; },
    get after() { accesses.push("after"); return false; },
  };
  throws(() => parse("a: 1\n", opts), (error) => error instanceof Error && /uniqueKeys/.test(error.message));
  deepStrictEqual(accesses, ["prettyErrors", "unknownUndefined", "mapAsMap", "uniqueKeys"]);

  const invalidAndReplacer = { invalidOption: true };
  throws(() => stringify({ a: 1 }, () => 0, invalidAndReplacer), (error) => error instanceof Error && /invalidOption/.test(error.message));
  const sentinel = { marker: "option-getter" };
  const rawThrow = Object.defineProperty({}, "prettyErrors", { enumerable: true, get() { throw sentinel; } });
  throws(() => parse("a: 1\n", rawThrow), (error) => error === sentinel);

  let filenameReads = 0;
  const filename = Object.defineProperty({}, "filename", { enumerable: true, get() { filenameReads += 1; return "bad.yaml"; } });
  throws(() => load("a: [\n", filename), (error) => error instanceof YAMLException);
  equal(filenameReads, 2); // validation reads it; error conversion reads it again
});
