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
import { parse, parseAll, YAMLParseError, NotImplementedError } from "../src/index.ts";
import { datasets, loadFixtureText } from "../bench/fixtures/datasets.ts";
import { oracleParse } from "../bench/oracle.ts";
import { makeRng, type Rng } from "../bench/util/prng.ts";
import { parseAllDocuments } from "yaml";

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
// M4 — block scalars (`|` literal, `>` folded): chomping, explicit indent
// indicators (both orders), auto-detected indentation, folding/more-indented
// interactions, placement (map value / seq entry / `--- |` doc root), and the
// empty-scalar edge cases. Every case is checked against the `yaml` oracle —
// semantics were calibrated against it directly (doc 07 §3.5), not derived
// from prose alone.
// --------------------------------------------------------------------------

const blockScalarOracle: string[] = [
  // chomping: clip (default) / strip (-) / keep (+)
  "key: |\n  line1\n  line2\n",
  "key: |-\n  line1\n  line2\n",
  "key: |+\n  line1\n  line2\n\n\nnext: 1\n",
  "key: |\n  line1\n  line2\n\n\nnext: 1\n",
  "key: |-\n  line1\n  line2\n\n\nnext: 1\n",
  // empty scalar (chomping still applies)
  "key: |\nnext: 1\n",
  "key: |-\nnext: 1\n",
  "key: |+\nnext: 1\n",
  "key: |\n",
  "key: |-\n",
  "key: |+\n",
  "key: |\n\n\nnext: 1\n",
  "key: |-\n\n\nnext: 1\n",
  "key: |+\n\n\nnext: 1\n",
  // explicit indentation indicator, both orders with chomping
  "key: |2\n    xxx\n",
  "- |2-\n  explicit indent and chomp\n",
  "- |-2\n  chomp and explicit indent\n",
  "- |1\n  explicit\n",
  // folded: basic, blank-line folding, more-indented lines never fold
  "key: >\n  some\n  text\n",
  "key: >\n  a\n\n  b\n",
  "key: >\n  a\n\n\n  b\n",
  "key: >\n  a\n   more\n  b\n",
  "key: >\n  a\n   b\n   c\n",
  "key: >\n  a\n   b\n\n   c\n",
  ">\n\n folded\n line\n\n next\n line\n   * bullet\n\n   * list\n   * lines\n\n last\n line\n\n# Comment\n",
  // `#` inside a block scalar's content is literal text, never a comment (at
  // the document root, content at column 0 is deeper than the root's implicit
  // parent column of -1, so this is legal there — but NOT as a map value at
  // column 0, where content must be deeper than the key; see the dedicated
  // throws() case below for that contrast)
  "--- >\nline1\n# no comment\nline3\n",
  // header trailing comment
  "key: | # comment\n  line1\n",
  // tabs: forbidden in indentation, ordinary once past it
  "key: |\n  \tfoo\n",
  "a:\n  b: |\n    line1\n    \tindented-tab-content\n",
  "k: |\n \tfoo\n",
  // leading blank lines: shallower is fine, deeper (auto-detect only) errors —
  // covered as a dedicated throws() case below; these are the accepted ones
  "k: |\n \n  real\n",
  "k: >\n  \n  content\n",
  // trailing content interacting with comments — a comment below the content
  // indent ends the scalar and is then transparently skipped for the caller
  "a:\n  b: |\n    text\n  # comment\n  c: 2\n",
  "a:\n  b: |\n    text\n\n  # comment\n  c: 2\n",
  // placement: map value, seq entry, compact seq-of-map, doc root (with and
  // without an inline `---` marker), and dedent back to a sibling map key
  "- |\n  detected\n- >\n \n  \n  # detected\n",
  "a:\n  - |\n    x\n  - 2\nb: 3\n",
  "- a: |\n    x\n  b: 2\n",
  "--- |\n  ab\n  cd\n",
  "--- >\n ab\n cd\n \n ef\n\n\n gh\n",
  "--- |+\n ab\n \n  \n...\n",
  "--- |-\n ab\n \n\n...\n",
  "a:\n  b: |\n    line1\n    line2\n  c: 2\n",
  "outer:\n  inner: |\n    text\n  sibling: 1\nafter: 2\n",
  // trailing whitespace on content lines is preserved (literal only strips
  // leading indentation, never trailing spaces)
  "key: |\n  abc   \n  def\n",
  // CRLF line endings
  "k: |\r\n  a\r\n  b\r\n",
  // no trailing newline at all in the source
  "k: |\n  line",
  "k: |-\n  line",
  "k: >\n  line",
];

for (const input of blockScalarOracle) {
  test(`block scalar matches oracle · ${input.replace(/\n/g, "\\n").slice(0, 48)}`, () => {
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

test("block scalar: chomping produces the exact documented strings (yaml-test-suite A6F9)", () => {
  const s = "strip: |-\n  text\nclip: |\n  text\nkeep: |+\n  text\n";
  deepStrictEqual(parse(s), { strip: "text", clip: "text\n", keep: "text\n" });
  deepStrictEqual(parse(s), oracleParse(s));
});

test("block scalar: explicit indentation indicator in either order (|2- vs |-2)", () => {
  deepStrictEqual(parse("- |2-\n  explicit indent and chomp\n- |-2\n  chomp and explicit indent\n"), [
    "explicit indent and chomp",
    "chomp and explicit indent",
  ]);
});

test("block scalar: a more-indented folded line is kept literally and its surrounding breaks are not folded", () => {
  deepStrictEqual(parse("key: >\n  a\n   more\n  b\n"), { key: "a\n more\nb\n" });
});

test("block scalar: N interior blank lines fold to exactly N newlines (folded)", () => {
  deepStrictEqual(parse("key: >\n  a\n\n  b\n"), { key: "a\nb\n" }); // 1 blank -> 1 newline
  deepStrictEqual(parse("key: >\n  a\n\n\n  b\n"), { key: "a\n\nb\n" }); // 2 blanks -> 2 newlines
});

test("block scalar: leading blank lines more indented than the auto-detected content indent are an error", () => {
  throws(() => parse("block scalar: >\n \n  \n   \n invalid\n"), YAMLParseError);
  throws(() => oracleParse("block scalar: >\n \n  \n   \n invalid\n"));
  // ...but an explicit indentation indicator bypasses the check entirely.
  deepStrictEqual(parse("k: |2\n       \n  content\n"), { k: "     \ncontent\n" });
});

test("block scalar: as a map value, content must be deeper than the key's own column — column 0 for both is an error, unlike at the document root", () => {
  // Contrast with "--- >\nline1\n...\n" (in blockScalarOracle above), which
  // succeeds: there the parent column is the document root's implicit -1, so
  // column-0 content is deeper. As a map value, the parent column is the
  // key's own column (0 here), so column-0 content is NOT deeper — content
  // never appears (auto-detect finds nothing), and "line1" is read back as
  // ordinary block-map continuation, which then fails for lack of a ':'.
  throws(() => parse("block: >\nline1\n# no comment\nline3\n"), YAMLParseError);
  throws(() => oracleParse("block: >\nline1\n# no comment\nline3\n"));
});

test("block scalar: tab characters in indentation are an error, matching the oracle", () => {
  throws(() => parse("key: |\n\tfoo\n"), YAMLParseError);
  throws(() => oracleParse("key: |\n\tfoo\n"));
  throws(() => parse("a:\n  b: |\n    line1\n\tc: 2\n"), YAMLParseError);
  throws(() => oracleParse("a:\n  b: |\n    line1\n\tc: 2\n"));
});

test("block scalar: a malformed header (stray content, or a comment glued on with no separating space) errors", () => {
  for (const s of ["folded: > first line\n  second line\n", "block: ># comment\n  scalar\n"]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
});

test("block scalar: an empty scalar (no content at all) is the empty string, chomping notwithstanding", () => {
  deepStrictEqual(parse("key: |\nnext: 1\n"), { key: "", next: 1 });
  deepStrictEqual(parse("key: |-\nnext: 1\n"), { key: "", next: 1 });
  deepStrictEqual(parse("key: |+\nnext: 1\n"), { key: "", next: 1 });
  // ...except "keep", which preserves purely-blank lines as literal newlines.
  deepStrictEqual(parse("key: |+\n\n\nnext: 1\n"), { key: "\n\n", next: 1 });
});

test("agrees with js-yaml on block scalars (1.2-core and js-yaml don't diverge here)", () => {
  for (const s of ["key: |\n  a\n  b\n", "key: >\n  a\n  b\n", "key: |-\n  a\n", "key: |+\n  a\n\nnext: 1\n"]) {
    deepStrictEqual(parse(s), jsYamlLoad(s));
  }
});

// --------------------------------------------------------------------------
// Regression tests for the adversarial-review findings (2026-07). One test per
// finding so a recurrence trips immediately. Fixed bugs assert the correct
// (oracle-matching) behaviour; deferred features assert a clean error rather
// than a silent mis-parse; the one known limitation locks its current output.
// --------------------------------------------------------------------------

test("regression [1]: plain mapping keys are scalar-typed and canonicalized (block + flow)", () => {
  deepStrictEqual(parse("00: 1"), { "0": 1 });
  deepStrictEqual(parse("0x10: 1"), { "16": 1 });
  deepStrictEqual(parse("True: 1"), { true: 1 });
  deepStrictEqual(parse("null: 1"), { "": 1 }); // null key → empty string
  deepStrictEqual(parse("{0o17: x, 1.50: y}"), { "15": "x", "1.5": "y" });
  deepStrictEqual(parse('"00": 1'), { "00": 1 }); // quoted key stays literal
  for (const s of ["00: 1", "0x10: 1", "True: 1", "null: 1", "{1e3: x}", "-0: q"]) {
    deepStrictEqual(parse(s), oracleParse(s));
  }
});

test("regression [2]: leading ':' in a flow sequence is plain unless a boundary colon", () => {
  deepStrictEqual(parse("[:ff]"), [":ff"]);
  deepStrictEqual(parse("[:00:]"), [{ ":00": null }]);
  deepStrictEqual(parse("[:]"), [{ "": null }]); // boundary → empty-key pair
  for (const s of ["[:ff]", "[:00:]", "[:]", "[: x]", "[a, :b]"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("regression [3]: document markers (--- / ...) now parse (M5), matching the oracle", () => {
  // Superseded by M5: these used to throw NotImplementedError; they now parse.
  strictEqual(parse("..."), null);
  strictEqual(parse("--- 5\n"), 5);
  strictEqual(parse("---\nfoo\n"), "foo");
  for (const s of ["...", "--- 5\n", "---\nfoo\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("regression [4]: YAML double-quoted escapes decode", () => {
  deepStrictEqual(parse('"\\x41"'), "A");
  deepStrictEqual(parse('"\\U0001F600"'), "😀");
  deepStrictEqual(parse('"\\0\\a\\v\\e\\_\\N"'), "\u0000\u0007\u000b\u001b\u00a0\u0085");
  for (const s of ['"\\x41"', '"\\U0001F600"', '"\\0\\a\\v\\e\\_\\N"']) deepStrictEqual(parse(s), oracleParse(s));
});

test("regression [5]: explicit key '? ' inside a flow sequence", () => {
  deepStrictEqual(parse("[? a: b]"), [{ a: "b" }]);
  deepStrictEqual(parse("[? a]"), [{ a: null }]);
  deepStrictEqual(parse("[? a: b]"), oracleParse("[? a: b]"));
});

test("regression [6]: '?' before a flow close is an explicit empty key", () => {
  deepStrictEqual(parse("{?}"), { "": null });
  deepStrictEqual(parse("{?}"), oracleParse("{?}"));
});

test("regression [7]: KNOWN LIMITATION — flow multi-line folding is not implemented", () => {
  // A double-quoted scalar with a LITERAL newline should fold to a space in YAML
  // (oracle → "a b"), but our fast path keeps the newline. Locked here so a
  // future fix has to update this expectation deliberately.
  strictEqual(parse('"a\nb"'), "a\nb");
});

test("regression [8]: block sequence indented at the parent mapping key's column", () => {
  deepStrictEqual(parse("key:\n- a\n- b\nnext: 1\n"), { key: ["a", "b"], next: 1 });
  deepStrictEqual(parse("a:\n- 1\nb:\n- 2\n"), { a: [1], b: [2] });
  for (const s of ["key:\n- a\n- b\nnext: 1\n", "a:\n- 1\nb:\n- 2\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("regression [9]: line-break folding in multi-line plain scalars (space vs newline)", () => {
  deepStrictEqual(parse("a\nb\n"), "a b"); // single break → space
  deepStrictEqual(parse("foo\n\nbar\n"), "foo\nbar"); // one blank → one newline
  deepStrictEqual(parse("a\n\n\nb\n"), "a\n\nb"); // two blanks → two newlines
  for (const s of ["a\nb\n", "foo\n\nbar\n", "a\n\n\nb\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("regression [10]: explicit block keys ('? '/': ') throw NotImplementedError", () => {
  throws(() => parse("? a\n: b\n"), NotImplementedError);
});

test("regression [11]: block scalars (| and >) now parse (M4), matching the oracle", () => {
  // Superseded by M4: these used to throw NotImplementedError; they now parse.
  deepStrictEqual(parse("key: |\n  line1\n  line2\n"), { key: "line1\nline2\n" });
  deepStrictEqual(parse("key: >\n  folded\n"), { key: "folded\n" });
  for (const s of ["key: |\n  line1\n  line2\n", "key: >\n  folded\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("regression [12]: integers spanning the Smi boundary accumulate exactly", () => {
  deepStrictEqual(parse("n: 2147483648\n"), { n: 2147483648 }); // 2^31
  deepStrictEqual(parse("n: 9999999999\n"), { n: 9999999999 });
  deepStrictEqual(parse("n: 900000000000000\n"), { n: 900000000000000 }); // 15 digits
  deepStrictEqual(parse("[2147483648, 4294967296]"), [2147483648, 4294967296]);
});

// [13] keyToString polymorphism is exercised by [1]; [14] (xlarge parse) is
// correctness-gated by the JSON-fixture parity loop above (xlarge-records is a
// json fixture), so both are covered without a dedicated case.

// --------------------------------------------------------------------------
// M5 — document markers (---/...), directives (%YAML/%TAG), multi-document
// streams. Calibrated against the `yaml` oracle via `parseAllDocuments`
// (scratch script, deleted) and cross-checked against the yaml-test-suite
// ground truth for the spec corners noted inline.
// --------------------------------------------------------------------------

/**
 * The oracle's multi-document reference: text -> array of document values.
 * `maxAliasCount` belongs to `toJS`'s options, not `parseAllDocuments`'s (see
 * bench/oracle.ts's note) — matches bench/conformance/run.ts's yamlLibParseDocs.
 */
function oracleParseAll(text: string): unknown[] {
  return parseAllDocuments(text).map((d) => {
    if (d.errors.length > 0) throw new Error(d.errors[0]!.message);
    return d.toJS({ maxAliasCount: -1 });
  });
}

const docMarkerOracle: string[] = [
  // leading '---'
  "--- 5\n",
  "---\nfoo\n",
  "--- foo\n",
  "---\n",
  "---",
  "--- \n",
  "---   #comment\nfoo\n",
  // trailing '...'
  "foo\n...\n",
  "--- foo\n...\n",
  "...",
  "---\n...\n",
  // inline scalar / flow after '---'
  "--- foo\n",
  "--- [a, b]\n",
  "--- {a: b}\n",
  "--- 'sq'\n",
  '--- "dq"\n',
  // '---' folds into a following bare scalar continuation when nothing follows
  // it as a new document (a genuine spec corner — the oracle needs lookahead
  // to disambiguate; see below for the one deliberately-skipped case)
  "--- foo\nbar\n",
  // bare document, unaffected by the feature
  "just a plain scalar document\n",
  "a: 1\nb: 2\n",
  // ---foo / ...foo are NOT markers (no trailing ws/EOL after the 3rd char)
  "---foo\n",
  "...foo\n",
];

for (const input of docMarkerOracle) {
  test(`doc marker matches oracle (single-doc parse) · ${input.replace(/\n/g, "\\n").slice(0, 44)}`, () => {
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

const multiDocOracle: string[] = [
  "--- a\n--- b\n",
  "--- a\n...\n--- b\n",
  "a\n...\nb\n",
  "---\n---\nb\n",
  "--- a\n--- b\n--- c",
  "%YAML 1.2\n--- a\n%YAML 1.2\n--- b\n",
];

for (const input of multiDocOracle) {
  test(`multi-doc matches oracle · ${input.replace(/\n/g, "\\n").slice(0, 44)}`, () => {
    deepStrictEqual(parseAll(input), oracleParseAll(input));
  });
}

test("leading '---' with an inline scalar/flow value", () => {
  deepStrictEqual(parse("--- 5\n"), 5);
  deepStrictEqual(parse("--- foo\n"), "foo");
  deepStrictEqual(parse("--- [1, 2, 3]\n"), [1, 2, 3]);
  deepStrictEqual(parse("--- {a: 1}\n"), { a: 1 });
});

test("a bare '---'/'---\\n' with no inline content starts the node on a following line", () => {
  deepStrictEqual(parse("---\nfoo\n"), "foo");
  deepStrictEqual(parse("---\na: 1\nb: 2\n"), { a: 1, b: 2 });
});

test("trailing '...' terminates the document", () => {
  deepStrictEqual(parse("foo\n...\n"), "foo");
  deepStrictEqual(parse("a: 1\n...\n"), { a: 1 });
});

test("bare documents (no markers at all) are unchanged", () => {
  deepStrictEqual(parse("a: 1\nb: 2\n"), { a: 1, b: 2 });
  deepStrictEqual(parse("- 1\n- 2\n"), [1, 2]);
  deepStrictEqual(parse("just a plain scalar document\n"), "just a plain scalar document");
});

test("empty document (via markers) is null", () => {
  strictEqual(parse("---\n"), null);
  strictEqual(parse("---"), null);
  strictEqual(parse("...\n"), null);
});

test("parseAll splits a '---'-separated multi-document stream", () => {
  deepStrictEqual(parseAll("--- a\n--- b\n"), ["a", "b"]);
  deepStrictEqual(parseAll("--- 1\n--- 2\n--- 3\n"), [1, 2, 3]);
});

test("parseAll splits a '...'-separated multi-document stream", () => {
  deepStrictEqual(parseAll("a\n...\nb\n"), ["a", "b"]);
});

test("parseAll handles a mix of '---' and '...' separators", () => {
  deepStrictEqual(parseAll("--- a\n...\n--- b\n"), ["a", "b"]);
  // The second '---' is itself bare (nothing before the next content line), so
  // its node is "b" — only 2 documents, not 3 (verified against the oracle).
  deepStrictEqual(parseAll("---\n---\nb\n"), [null, "b"]);
  deepStrictEqual(parseAll("---\n---\n"), [null, null]);
});

test("a bare document may only start the stream or follow an explicit '...' — unmarked trailing content after a document is an error, not a second bare document", () => {
  // Regression: a flow-value document's content simply ends when its closing
  // bracket is seen; without a '...' before it, following unmarked content
  // is NOT a legitimate second document (grammar: l-bare-document is only
  // legal first, or right after a document-suffix). Caught by comparing
  // against the oracle, which also rejects this as a single malformed doc.
  throws(() => parseAll("--- [1, 2]\nnope\n"), YAMLParseError);
  throws(() => oracleParseAll("--- [1, 2]\nnope\n"));
  // With an explicit '...' in between, the second bare document IS legal.
  deepStrictEqual(parseAll("--- [1, 2]\n...\nnope\n"), [
    [1, 2],
    "nope",
  ]);
});

test("directives: %YAML is accepted (1.1 and 1.2) and requires a following '---'", () => {
  deepStrictEqual(parse("%YAML 1.2\n---\nx\n"), "x");
  deepStrictEqual(parse("%YAML 1.1\n---\nx\n"), "x"); // accepted, not rejected
  throws(() => parse("%YAML 1.2\nx\n"), YAMLParseError); // no '---' before content
  throws(() => parse("%YAML 1.2\n"), YAMLParseError); // no '---' before EOF either
});

test("directives: %TAG is accepted and stored without requiring tags to be implemented", () => {
  deepStrictEqual(parse("%TAG !e! tag:example.com,2000:\n---\nfoo\n"), "foo");
});

test("directives: an unrecognized directive is ignored, not rejected", () => {
  deepStrictEqual(parse("%FOO bar baz\n---\nx\n"), "x");
});

test("directives: a directives block must be terminated by an explicit '---'", () => {
  throws(() => parse("%YAML 1.2\nx\n"), YAMLParseError);
  throws(() => parseAll("%YAML 1.2\nx\n"), YAMLParseError);
});

test("directives: duplicate %YAML in one document is rejected", () => {
  // Deliberately stricter than our own oracle here: `yaml`'s parse() is lenient
  // about a repeated %YAML directive, but js-yaml throws ("duplication of %YAML
  // directive") and yaml-test-suite/SF5V expects an error too — we match those.
  throws(() => parse("%YAML 1.2\n%YAML 1.2\n---\n"), YAMLParseError);
  throws(() => jsYamlLoad("%YAML 1.2\n%YAML 1.2\n---\n"));
});

test("parse() throws on a second document (single-document contract, like js-yaml load)", () => {
  throws(() => parse("--- a\n--- b\n"), YAMLParseError);
  throws(() => parse("a\n---\nb\n"), YAMLParseError);
});

test("SPEC CORNER (documented, not chased): a block collection cannot start on the same " + "line as '---' — the oracle and yaml-test-suite (9KBC/CXX2) agree this errors", () => {
  throws(() => parse("--- key1: value1\n"), YAMLParseError);
  throws(() => parse("--- - a\n- b\n"), YAMLParseError);
  throws(() => oracleParse("--- key1: value1\n"));
});

for (const input of ["[1, 2]", '{"a": 1}', "true", "null"]) {
  test(`agrees with js-yaml on parseAll for a single bare document · ${input}`, () => {
    deepStrictEqual(parseAll(input), [jsYamlLoad(input)]);
  });
}

// --------------------------------------------------------------------------
// API surface.
// --------------------------------------------------------------------------

test("parseAll returns an array of documents", () => {
  deepStrictEqual(parseAll("[1, 2]"), [[1, 2]]);
});

test("empty input parses to null", () => {
  strictEqual(parse(""), null);
  strictEqual(parse("   \n  "), null);
});

test("empty input to parseAll is an empty document array", () => {
  deepStrictEqual(parseAll(""), []);
  deepStrictEqual(parseAll("   \n  "), []);
});

test("a leading BOM is ignored", () => {
  deepStrictEqual(parse("﻿[1, 2, 3]"), [1, 2, 3]);
});

test("a leading BOM before directives/markers is ignored", () => {
  deepStrictEqual(parse("﻿%YAML 1.2\n---\nx\n"), "x");
});
