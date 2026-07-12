/**
 * lightning-yaml unit tests (node:test). Run with:
 *   node --import tsx --test test/parser.unit.ts
 *
 * These are the parser's own fast, focused tests — distinct from the vitest
 * consistency suite (which pins the whole fixture corpus against the `yaml`
 * oracle). They cover: exact `JSON.parse` parity on the JSON fixtures, an
 * escape/unicode/bignum torture set, prototype-pollution and depth-guard
 * security, error behaviour, and differential spot-checks against js-yaml.
 *
 * Named `*.unit.ts` (not `*.test.ts`) so vitest's glob ignores it.
 */

import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws, ok } from "node:assert";
import { load as jsYamlLoad, dump as jsYamlDump } from "js-yaml";
import { parse, parseAll, YAMLParseError } from "../src/index.ts";
import { datasets, loadFixtureText } from "../bench/fixtures/datasets.ts";
import { oracleParse } from "../bench/oracle.ts";
import { makeRng, type Rng } from "../bench/util/prng.ts";

// --------------------------------------------------------------------------
// M1 — exact JSON.parse parity on every JSON (flow) fixture.
// --------------------------------------------------------------------------

const jsonFixtures = datasets.filter((d) => d.category === "json");

for (const ds of jsonFixtures) {
  test(`JSON fixture parity · ${ds.name}`, () => {
    const text = loadFixtureText(ds);
    deepStrictEqual(parse(text), JSON.parse(text));
  });
}

// --------------------------------------------------------------------------
// M1 — escape / unicode / number torture, all checked against JSON.parse.
// --------------------------------------------------------------------------

const torture = [
  '"hello world"',
  '""',
  '"a\\nb\\tc\\"d\\\\e\\/f\\b\\f\\r"',
  '"\\u0041\\u00e9\\u4e2d"',
  '"\\uD834\\uDD1E"', // astral pair
  '"\\uD800"', // lone high surrogate (valid JSON)
  '"tab\\tafter"',
  '0',
  '-0',
  '0.0',
  '42',
  '-42',
  '3.14159',
  '1e10',
  '1E-10',
  '1.5e+3',
  '2.5E10',
  '123456789012345', // 15 digits, Smi/exact
  '1234567890123456', // 16 digits, falls to Number()
  '12345678901234567890', // beyond 2^53
  '9007199254740993', // 2^53 + 1
  '1.7976931348623157e308',
  '5e-324',
  '-1.5',
  'true',
  'false',
  'null',
  '[]',
  '{}',
  '[1, 2, 3, "four", true, false, null]',
  '{"a": [1, {"b": 2}], "c": {"d": null}}',
  '  \n\t [1,\n 2 ,\t3]  \n ',
  '{"unicode✓": "value", "emoji": "🎉", "mix": "a✓b"}',
  '[[[[[[42]]]]]]',
];

for (const input of torture) {
  test(`torture parity · ${input.slice(0, 40)}`, () => {
    deepStrictEqual(parse(input), JSON.parse(input));
  });
}

test("duplicate keys are last-wins (JSON.parse semantics)", () => {
  deepStrictEqual(parse('{"k": 1, "k": 2}'), JSON.parse('{"k": 1, "k": 2}'));
  deepStrictEqual(parse('{"k": 1, "k": 2}'), { k: 2 });
});

test("negative zero is preserved", () => {
  ok(Object.is(parse("-0"), -0));
  strictEqual(Object.is((parse("[-0]") as number[])[0], -0), true);
});

// --------------------------------------------------------------------------
// Security — prototype pollution and recursion depth.
// --------------------------------------------------------------------------

test("__proto__ becomes an own property, does not pollute the prototype", () => {
  const value = parse('{"__proto__": {"polluted": true}, "safe": 1}');
  // No prototype pollution leaked to a fresh object.
  const probe = {} as Record<string, unknown>;
  strictEqual(probe.polluted, undefined);
  // And it matches JSON.parse (an own, enumerable __proto__ data property).
  deepStrictEqual(value, JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}'));
  ok(Object.prototype.hasOwnProperty.call(value, "__proto__"));
});

test("constructor / prototype keys are ordinary keys", () => {
  deepStrictEqual(
    parse('{"constructor": 1, "prototype": 2}'),
    JSON.parse('{"constructor": 1, "prototype": 2}'),
  );
});

test("deeply nested input throws a controlled error, not a RangeError", () => {
  const deep = "[".repeat(5000) + "]".repeat(5000);
  throws(
    () => parse(deep),
    (err: unknown) => err instanceof YAMLParseError && /depth/.test((err as Error).message),
  );
});

test("nesting up to the guard still parses", () => {
  const n = 500;
  const deep = "[".repeat(n) + "]".repeat(n);
  const value = parse(deep);
  // Walk to the bottom to confirm the structure.
  let cur: unknown = value;
  let d = 0;
  while (Array.isArray(cur)) {
    cur = cur[0];
    d++;
  }
  strictEqual(d, n);
});

// --------------------------------------------------------------------------
// Errors — malformed input surfaces a YAMLParseError.
// --------------------------------------------------------------------------

// Genuinely malformed (in YAML too — not just JSON-strict). Note that `{"a": }`
// (→ {a:null}), `nul` (→ "nul") and `01x2` (→ "01x2") are all VALID YAML plain
// scalars, so they are covered by the differential suite below, not here.
for (const bad of ["[1, 2", '{"a" 1}', "{,}", "[,]", "[a, , b]", '"unterminated', "'unterminated", "{a: b"]) {
  test(`malformed input throws · ${bad}`, () => {
    throws(() => parse(bad), YAMLParseError);
  });
}

// --------------------------------------------------------------------------
// Differential spot-checks vs js-yaml on inputs both must agree on (quoted
// strings, numbers, keywords, flow collections — no 1.1-vs-1.2 divergence).
// --------------------------------------------------------------------------

const agreeWithJsYaml = [
  '[1, 2, 3]',
  '{"a": 1, "b": 2}',
  '"just a string"',
  '[true, false, null]',
  '{"nested": {"x": [1, 2]}}',
  '3.14',
  '-17',
  '[]',
  '{}',
];

for (const input of agreeWithJsYaml) {
  test(`agrees with js-yaml · ${input.slice(0, 40)}`, () => {
    deepStrictEqual(parse(input), jsYamlLoad(input));
  });
}

// --------------------------------------------------------------------------
// M2 — flow-mode YAML, checked against the `yaml` oracle (1.2 core schema).
// Every case here parses to EXACTLY what the repo's ground-truth oracle
// produces: plain-scalar typing, quoting, comments, single-pair maps.
// --------------------------------------------------------------------------

const flowOracle = [
  // null / bool forms (exact case; yes/no/on/off are strings)
  "[null, Null, NULL, ~, NuLL]",
  "[true, True, TRUE, false, False, FALSE, TrUe]",
  "[yes, no, on, off, y, n]",
  // integers: decimal (leading zeros ok), octal, hex — NOT 0b, NOT underscores
  "[0, -0, 42, -42, +42, 007, 00, 0o17, 0o777, 0x1A, 0xFF, 0xdeadBEEF]",
  "[0b101, 1_000, 0o8, 0x, 0xG]",
  // floats + inf/nan
  "[3.14, -3.14, .5, +.5, -.5, 5., 1.e5, 1e10, 1E-10, 0.0, .0]",
  "[.inf, -.inf, .Inf, .INF, .nan, .NaN]",
  "[.e5, 1e, 1e+, 1.2.3, ., .., 123abc]",
  // strings that merely look numeric / date-like (1.2 core keeps these strings)
  "[2026-08-02, 2026-07-12T10:30:00Z, 1:30, 1:2:3, 79d5-1c2791, 5c76-ae4c8d]",
  // plain scalars with spaces, colons, hashes
  "[mike alpha, http://x.io, a#b, key val]",
  // flow maps: colon needs a separator to split; quoted keys split without one
  "{a: b}",
  "{a:b}",
  '{"a":b}',
  "{a: 1, b: two, c: true, d: null, e: 3.14}",
  "{http://x: y}",
  "{a: b, x: [1, 2, 3], y: {z: 1}}",
  // empty values
  "{a}",
  "{a: }",
  "{a: , b: c}",
  "{a, b, c}",
  // trailing commas
  "[1, 2, 3,]",
  "{a: 1, b: 2,}",
  // single-pair maps inside sequences
  "[a: b]",
  "[a: b, c: d]",
  "[1, 2: 3, four]",
  "[:]",
  // explicit keys
  "{? explicit: val}",
  "{? key}",
  // quoting: single, double, '' escape, escapes
  "[a, 'sq str', \"dq str\"]",
  "['it''s a test', 'plain']",
  '["tab\\tend", "new\\nline", "u\\u0041"]',
  "{'sq key': 1, \"dq key\": 2}",
  // comments in flow
  "[a #comment\n, b]",
  "{a: 1 # trailing\n, b: 2}",
  // empty collections with whitespace
  "[ ]",
  "{ }",
  "[]",
  "{}",
  // nesting + mixed
  "{key: [a, b], n: {x: 1, y: [true, null, 2.5]}}",
  "[[1, 2], [3, 4], {a: [5, 6]}]",
];

for (const input of flowOracle) {
  test(`flow matches oracle · ${input.replace(/\n/g, "\\n").slice(0, 44)}`, () => {
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

test("plain scalars that are not numbers stay strings", () => {
  const s = "[01x2, nul, tru, fals, 1x, 0xG, 0b1, 1_000]";
  deepStrictEqual(parse(s), oracleParse(s));
  deepStrictEqual(parse(s), ["01x2", "nul", "tru", "fals", "1x", "0xG", "0b1", "1_000"]);
});

test("empty flow value is null (not a JSON error)", () => {
  deepStrictEqual(parse("{a: }"), { a: null });
  deepStrictEqual(parse("{a}"), { a: null });
});

// --------------------------------------------------------------------------
// M3 — block structure. Fixture parity + hand-crafted cases + a seeded
// round-trip corpus, all checked against the oracle / js-yaml.
// --------------------------------------------------------------------------

// The block yaml-plain fixtures must match the oracle exactly (the consistency
// suite checks these too; kept here so the unit run is self-contained).
for (const ds of datasets.filter((d) => d.category === "yaml-plain")) {
  test(`block fixture parity · ${ds.name}`, () => {
    const text = loadFixtureText(ds);
    deepStrictEqual(parse(text), oracleParse(text));
  });
}

const blockOracle: string[] = [
  // simple block mapping
  "a: 1\nb: two\nc: true\nd: null\ne: 3.14\n",
  // block sequence of scalars
  "- 1\n- two\n- true\n- null\n",
  // nested map
  "outer:\n  inner:\n    x: 1\n    y: 2\n  z: 3\nq: 4\n",
  // sequence of maps (compact form: `- key: val`)
  "- id: 0\n  name: alpha\n- id: 1\n  name: bravo\n",
  // map with sequence values
  "tags:\n  - a\n  - b\nnums:\n  - 1\n  - 2\n",
  // deeply nested compact sequences
  "- - - deep\n",
  // inline flow inside block
  "list: [1, 2, 3]\nmap: {x: 1, y: 2}\nempty_list: []\nempty_map: {}\n",
  // plain scalar values with spaces / colons-in-url / hashes
  "name: mike alpha bravo\nurl: http://example.com/x\nnote: a#b not a comment\n",
  // empty values
  "a:\nb: 1\nc:\n",
  // comments interspersed
  "# header\na: 1  # trailing\n# between\nb: 2\n",
  // quoted keys and values in block
  '"quoted key": value\nplain: "quoted value"\nsingle: \'sq value\'\n',
  // multi-word plain scalar that looks partly numeric
  "version: 1 point 0\ndate_str: 2026-08-02\ncount: 42\n",
  // block map whose value is a block map on the next line at deeper indent
  "meta:\n  views: 100\n  ratio: 0.5\n",
  // sequence with an empty-then-filled entry
  "- a: 1\n  b: 2\n- c: 3\n",
  // a bare scalar document
  "just a plain scalar document\n",
  "42\n",
  "true\n",
  // multi-line plain scalar (folds to a single space-joined string)
  "text: this is a\n  folded plain\n  scalar value\nother: 1\n",
];

for (const input of blockOracle) {
  test(`block matches oracle · ${input.replace(/\n/g, "\\n").slice(0, 40)}`, () => {
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

// Seeded round-trip corpus: random JSON-compatible values dumped as block YAML
// by js-yaml must parse back (via ours) to the original, and agree with js-yaml.
function makeValue(rng: Rng, d: number): unknown {
  if (d <= 0) {
    switch (rng.int(0, 6)) {
      case 0:
        return rng.int(-100000, 100000);
      case 1:
        return Number(rng.float(-1000, 1000).toFixed(4));
      case 2:
        return rng.bool();
      case 3:
        return null;
      case 4:
        return rng.words(rng.int(1, 4));
      case 5:
        return String(rng.int(0, 999)); // numeric-looking string; dump quotes it
      default:
        return rng.words(1);
    }
  }
  if (rng.bool()) {
    const o: Record<string, unknown> = {};
    const n = rng.int(1, 5);
    for (let i = 0; i < n; i++) o[`field_${i}`] = makeValue(rng, d - 1);
    return o;
  }
  const n = rng.int(0, 5);
  const a: unknown[] = [];
  for (let i = 0; i < n; i++) a.push(makeValue(rng, d - 1));
  return a;
}

test("block round-trip corpus (600 seeded cases) matches js-yaml and the original", () => {
  const rng = makeRng(4242);
  for (let i = 0; i < 600; i++) {
    const value = makeValue(rng, rng.int(1, 5));
    const text = jsYamlDump(value);
    const ours = parse(text);
    deepStrictEqual(ours, value, `round-trip #${i}\n${text}`);
    deepStrictEqual(ours, jsYamlLoad(text), `vs js-yaml #${i}\n${text}`);
  }
});

// --------------------------------------------------------------------------
// API surface.
// --------------------------------------------------------------------------

test("parseAll returns an array of documents (single-doc for now)", () => {
  deepStrictEqual(parseAll('[1, 2]'), [[1, 2]]);
});

test("empty input parses to null", () => {
  strictEqual(parse(""), null);
  strictEqual(parse("   \n  "), null);
});

test("a leading BOM is ignored", () => {
  deepStrictEqual(parse("﻿[1, 2, 3]"), [1, 2, 3]);
});
