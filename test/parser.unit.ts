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
import { parse, parseAll, stringify, YAMLParseError } from "../src/index.ts";
import { datasets, loadFixtureText } from "../bench/fixtures/datasets.ts";
import { oracleParse } from "../bench/oracle.ts";
import { makeRng, type Rng } from "../bench/util/prng.ts";
import { parseAllDocuments } from "yaml";

/**
 * Strip the uniform leading indentation that backtick nesting adds, so a
 * multi-line YAML fixture reads as itself instead of a `\n`-spliced literal.
 * Convention: write the content flush to the closing-backtick column; that
 * column's whitespace is removed from every line, the opening newline is
 * dropped, and a single trailing `\n` is (re)added. Only literal spaces are
 * stripped — a meaningful space-then-tab inside a line survives — and `\t`/`\n`
 * in the template are already real tab/newline characters.
 */
function dedent(strings: TemplateStringsArray): string {
  const raw = strings[0];
  const lastNl = raw.lastIndexOf("\n");
  const indent = raw.slice(lastNl + 1);
  const body = raw.slice(raw.indexOf("\n") + 1, lastNl);
  return body.split("\n").map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join("\n") + "\n";
}

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

test("regression [7]: quoted-scalar multi-line flow folding matches the oracle", () => {
  // A quoted scalar with a LITERAL newline folds to a space; blank lines become
  // preserved newlines; leading whitespace on continuation lines (spaces AND
  // tabs) is stripped, and trailing whitespace before a break is trimmed — but a
  // trailing space before the CLOSING quote is content, not stripped.
  for (const s of [
    '"a\nb"', // single break → space
    '"a\n\nb"', // one blank line → one newline
    '"a\n\n\nb"', // two blank lines → two newlines
    '"a   \n   b"', // trailing + leading whitespace stripped around the fold
    "'a\nb'", // single-quoted folds identically
    "'x\n\ny'",
    '"a\n  \tb"', // leading tab on the continuation stripped
    '" trailing "', // no break: leading/trailing space is content
  ]) {
    strictEqual(parse(s), oracleParse(s));
  }
  strictEqual(parse('"a\nb"'), "a b");
  // An escaped whitespace char (`\<TAB>` / `\ `) is literal content, protected
  // from folding — matches js-yaml and the `yaml` oracle.
  strictEqual(parse('"a\\\tb"'), "a\tb");
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

test("regression [10]: explicit block keys ('? '/': ') now parse, matching the oracle", () => {
  // Superseded: these used to throw NotImplementedError; they now parse (see
  // the dedicated "explicit block keys" section below for full coverage).
  deepStrictEqual(parse("? a\n: b\n"), { a: "b" });
  deepStrictEqual(parse("? a\n: b\n"), oracleParse("? a\n: b\n"));
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

test("directives: %YAML with a higher major version is rejected (spec §6.8.1)", () => {
  throws(() => parse("%YAML 2.0\n---\nfoo: bar\n"), YAMLParseError);
  throws(() => jsYamlLoad("%YAML 2.0\n---\nfoo: bar\n"));
  // A higher *minor* is still accepted (process-with-warning, not rejected) —
  // regression guard so 1.x keeps working.
  deepStrictEqual(parse("%YAML 1.3\n---\nx\n"), "x");
});

test("directives: %TAG is accepted and stored without requiring tags to be implemented", () => {
  deepStrictEqual(parse("%TAG !e! tag:example.com,2000:\n---\nfoo\n"), "foo");
});

test("directives: duplicate %TAG for the same handle in one document is rejected (spec §6.8.2)", () => {
  throws(() => parse("%TAG ! !foo\n%TAG ! !foo\n---\nbar\n"), YAMLParseError);
  // Different handles are not a duplicate — regression guard.
  deepStrictEqual(parse("%TAG ! !foo\n%TAG !e! !bar\n---\nbaz\n"), "baz");
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

// --------------------------------------------------------------------------
// M5 — anchors (`&name`) and aliases (`*name`). Every case is checked against
// the `yaml` oracle (calibrated directly against it, per the task recipe —
// several corners here are NOT obvious from prose alone: e.g. an anchor
// immediately before a scalar-becoming-a-key attaches to the KEY, but the
// SAME anchor deferred to its own line before a mapping attaches to the MAP
// — see `afterInlineProperty`'s doc comment in src/index.ts).
// --------------------------------------------------------------------------

const anchorAliasOracle: string[] = [
  // anchor on a scalar, flow alias
  "[&a 1, *a, 2]",
  // anchor on a scalar, block alias as a map value
  "a: &x 1\nb: *x\n",
  // anchor on a scalar, block alias as a sequence entry
  "- &x 1\n- *x\n- 2\n",
  // anchor on a flow map, alias reuses it
  "a: &m {x: 1, y: 2}\nb: *m\n",
  // anchor on a flow sequence, alias reuses it
  "a: &s [1, 2, 3]\nb: *s\n",
  // anchor on a block map (deferred to the next line), alias reuses it
  "a: &m\n  x: 1\n  y: 2\nb: *m\n",
  // anchor on a block sequence (deferred to the next line), alias reuses it
  "a: &s\n  - 1\n  - 2\nb: *s\n",
  // anchor alone at the document root before a block sequence (3R3P)
  "&seq\n- a\n- b\n",
  // anchor for an empty node (nothing after the anchor)
  "a: &x\nb: *x\n",
  // anchor on a mapping key (unreferenced) — parses fine, doesn't affect output
  "&a a: b\nc: &d d\n",
  // alias used AS a mapping key
  "&a a: &b b\n*b : *a\n",
  // multiple aliases to the same anchor
  "- &a a\n- &b b\n- *a\n- *b\n",
  // anchor redefinition: a later `&x` shadows the earlier one for later aliases
  "a: &x 1\nb: &x 2\nc: *x\n",
  // anchor/alias names containing a colon (colon is NOT a name terminator)
  "key: &an:chor value\n",
  // anchor name containing exotic (non-flow-indicator) characters
  'a: &:@*!$"<foo>: scalar a\nb: *:@*!$"<foo>:\n',
  // anchor name with a unicode character
  "- &😁 unicode anchor\n",
  // flow: anchors/aliases at various positions inside a flow sequence
  "&flowseq [\n a: b,\n &c c: d,\n { &e e: f },\n &g { g: h }\n]",
];

for (const input of anchorAliasOracle) {
  test(`anchor/alias matches oracle · ${input.replace(/\n/g, "\\n").slice(0, 48)}`, () => {
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

test("anchors are per-DOCUMENT, not per-stream (an alias cannot reach across '---')", () => {
  deepStrictEqual(parseAll("--- &a foo\n--- a\n"), ["foo", "a"]); // sanity: two independent docs
  throws(() => parseAll("--- &a foo\n--- *a\n"), YAMLParseError);
  throws(() => oracleParseAll("--- &a foo\n--- *a\n"));
});

test("structural sharing: an alias resolves to the SAME reference, not a deep copy", () => {
  const result = parse("cfg: &shared\n  region: us-west\n  tier: 3\nx: *shared\ny: *shared\n") as {
    cfg: object;
    x: object;
    y: object;
  };
  strictEqual(result.x, result.cfg);
  strictEqual(result.y, result.cfg);
  deepStrictEqual(result, oracleParse("cfg: &shared\n  region: us-west\n  tier: 3\nx: *shared\ny: *shared\n"));
});

test("structural sharing holds across flow, block map, and block sequence anchors", () => {
  const flowResult = parse("a: &m {x: 1}\nb: *m\n") as { a: object; b: object };
  strictEqual(flowResult.a, flowResult.b);

  const blockMapResult = parse("a: &m\n  x: 1\nb: *m\n") as { a: object; b: object };
  strictEqual(blockMapResult.a, blockMapResult.b);

  const blockSeqResult = parse("a: &s\n  - 1\n  - 2\nb: *s\n") as { a: object; b: object };
  strictEqual(blockSeqResult.a, blockSeqResult.b);
});

test("self-referential (cyclic) anchors resolve to the SAME object, never a deep copy", () => {
  const arr = parse("&a [1, *a]") as unknown[];
  strictEqual(arr[1], arr);

  const obj = parse("&a {self: *a}") as Record<string, unknown>;
  strictEqual(obj.self, obj);

  const blockObj = parse("&a\nself: *a\n") as Record<string, unknown>;
  strictEqual(blockObj.self, blockObj);
});

test("anchor redefinition is allowed — a later anchor shadows the earlier one for later aliases", () => {
  deepStrictEqual(parse("a: &x 1\nb: &x 2\nc: *x\n"), { a: 1, b: 2, c: 2 });
  deepStrictEqual(parse("a: &x 1\nb: &x 2\nc: *x\n"), oracleParse("a: &x 1\nb: &x 2\nc: *x\n"));
});

// --------------------------------------------------------------------------
// STRICTNESS — a negative-suite win over leniency (js-yaml v5 / the oracle
// both reject these; see CLAUDE.md's mandate for this feature).
// --------------------------------------------------------------------------

test("STRICTNESS: an alias to an undefined/unknown anchor throws", () => {
  throws(() => parse("*undefined"), YAMLParseError);
  throws(() => parse("a: *undefined\n"), YAMLParseError);
  throws(() => parse("[1, *nope, 3]"), YAMLParseError);
  throws(() => oracleParse("*undefined"));
});

test("STRICTNESS: a malformed (empty) anchor/alias name throws, matching the oracle", () => {
  for (const s of ["a: &\nb: 1\n", "a: & \nb: 1\n", "[&, 1]", "[*, 1]", "a: *\nb: 1\n"]) {
    throws(() => parse(s), YAMLParseError, s);
    throws(() => oracleParse(s), Error, s);
  }
});

test("STRICTNESS: an anchor cannot carry an alias as its own value (a node with an anchor cannot itself be an alias)", () => {
  // yaml-test-suite SR86 / SU74.
  throws(() => parse("key1: &a value\nkey2: &b *a\n"), YAMLParseError);
  throws(() => oracleParse("key1: &a value\nkey2: &b *a\n"));
  throws(() => parse("key1: &alias value1\n&b *alias : value2\n"), YAMLParseError);
});

test("STRICTNESS: a block sequence may not start on the same line as a node property", () => {
  // yaml-test-suite SY6V.
  throws(() => parse("&anchor - sequence entry\n"), YAMLParseError);
  throws(() => oracleParse("&anchor - sequence entry\n"));
});

test("agrees with js-yaml on anchors/aliases", () => {
  const cases = ["a: &x 1\nb: *x\n", "[&a 1, *a]", "- &x 1\n- *x\n", "a: &m {x: 1}\nb: *m\n"];
  for (const s of cases) deepStrictEqual(parse(s), jsYamlLoad(s));
});

// --------------------------------------------------------------------------
// M5 — tags (`!!`-core schema, `!!binary`, `%TAG`-resolved shorthands,
// verbatim/local tags, and tag↔typing interaction). Every case is calibrated
// directly against the `yaml` oracle (per the task recipe) except the
// mandatory STRICTNESS cases below, where we deliberately follow js-yaml
// instead — the oracle is lenient by design for tag/content mismatches (warns
// and keeps the raw scalar rather than throwing), while js-yaml (and the
// spec) treat them as hard errors; that divergence is intentional and
// documented at each STRICTNESS case.
// --------------------------------------------------------------------------

const tagOracleCases: string[] = [
  // core schema tags override implicit typing
  "a: !!str 123\n",
  "a: !!str true\n",
  'a: !!int "42"\n',
  "a: !!int 0x10\n",
  "a: !!int 0o17\n",
  // NOTE: "!!float 3" (int-looking content) is deliberately NOT in this list —
  // we follow js-yaml (→ number 3) over the oracle, which requires a stricter
  // float-only regex and leaves it unresolved as the string "3" (see the
  // STRICTNESS/agrees-with-js-yaml tests below for that documented divergence).
  "a: !!float 3.5\n",
  "a: !!float 3e10\n",
  "a: !!bool True\n",
  "a: !!bool false\n",
  "a: !!null ~\n",
  "a: !!null\n",
  // tags on collections (kind must match; passthrough otherwise)
  "a: !!map\n  x: 1\n",
  "a: !!seq\n  - 1\n  - 2\n",
  "!!map {\n  k: !!seq\n  [ a, !!str b]\n}\n",
  // tag + anchor, both orders
  "a: !!str &x hi\nb: *x\n",
  "a: &x !!str hi\nb: *x\n",
  "a: !!map &m {x: 1}\nb: *m\n",
  " - &a !!str a\n - !!int 2\n - !!int &c 4\n - &d d\n",
  // %TAG-resolved shorthand
  "%TAG !e! tag:example.com,2000:app/\n---\n!e!foo bar\n",
  "%TAG !yaml! tag:yaml.org,2002:\n---\n!yaml!str \"foo\"\n",
  // verbatim tags
  "a: !<tag:yaml.org,2002:str> 123\n",
  "a: !<!bar> baz\n",
  "!<tag:yaml.org,2002:str> foo :\n  !<!bar> baz\n",
  // non-specific '!' forces string typing, same as an unrecognized tag
  '- "12"\n- 12\n- ! 12\n',
  "a: !foo 123\n",
  "anchored: !local &anchor value\nalias: *anchor\n",
  // tagged plain/quoted keys (same-line tag decorates the KEY)
  "!!str a: 1\n",
  "!!str 23: !!bool false\n",
  '!!str &a1 "foo":\n  !!str bar\n&a2 baz : *a1\n',
  // a DEFERRED tag decorates the finished collection, not the first key
  "key: !!map\n  a: 1\n  b: 2\n",
  "key: !!str\n  hi there\n",
];

for (const input of tagOracleCases) {
  test(`tag matches oracle · ${input.replace(/\n/g, "\\n").slice(0, 52)}`, () => {
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

test("!!binary decodes to a Uint8Array (not a Node Buffer) with exact bytes", () => {
  const result = parse("payload: !!binary |-\n  aGVsbG8gd29ybGQh\n") as { payload: Uint8Array };
  ok(result.payload instanceof Uint8Array, "expected a Uint8Array");
  strictEqual(Object.getPrototypeOf(result.payload), Uint8Array.prototype, "must be a PLAIN Uint8Array, not a Buffer");
  deepStrictEqual(Buffer.from(result.payload).toString("utf8"), "hello world!");
  deepStrictEqual(result, oracleParse("payload: !!binary |-\n  aGVsbG8gd29ybGQh\n"));
});

test("!!binary strips embedded whitespace across multi-line base64", () => {
  const result = parse("a: !!binary |\n  aGVsbG8g\n  d29ybGQh\n") as { a: Uint8Array };
  deepStrictEqual(Buffer.from(result.a).toString("utf8"), "hello world!");
  deepStrictEqual(result, oracleParse("a: !!binary |\n  aGVsbG8g\n  d29ybGQh\n"));
});

test("!!set / !!omap / !!pairs resolve to the oracle's real Set/Map/array shapes", () => {
  const setResult = parse("--- !!set\na: null\nb: null\n") as Set<string>;
  ok(setResult instanceof Set);
  deepStrictEqual(setResult, oracleParse("--- !!set\na: null\nb: null\n"));

  const omapResult = parse("--- !!omap\n- a: 1\n- b: 2\n") as Map<string, unknown>;
  ok(omapResult instanceof Map);
  deepStrictEqual([...omapResult.entries()], [...(oracleParse("--- !!omap\n- a: 1\n- b: 2\n") as Map<string, unknown>).entries()]);

  const pairsInput = "--- !!pairs\n- a: 1\n- a: 2\n";
  deepStrictEqual(parse(pairsInput), oracleParse(pairsInput));
});

test("STRICTNESS: two tags on one node throws (matches the oracle: 'at most one tag')", () => {
  throws(() => parse("a: !!str !!int 5\n"), YAMLParseError);
  throws(() => oracleParse("a: !!str !!int 5\n"));
});

test("STRICTNESS: an alias node cannot carry a tag property (matches the oracle)", () => {
  throws(() => parse("a: &x hi\nb: !!str *x\n"), YAMLParseError);
  throws(() => oracleParse("a: &x hi\nb: !!str *x\n"));
});

test("STRICTNESS: !!int on non-integer content throws (js-yaml semantics; the oracle is lenient here — documented divergence)", () => {
  throws(() => parse("a: !!int notanint\n"), YAMLParseError);
  throws(() => parse("a: !!int 3.5\n"), YAMLParseError); // a decimal point isn't a core-schema integer
  throws(() => jsYamlLoad("a: !!int notanint\n"), Error);
});

test("STRICTNESS: !!bool/!!null on non-matching content throws (js-yaml semantics; documented oracle divergence)", () => {
  throws(() => parse("a: !!bool yes\n"), YAMLParseError); // YAML-1.1-ism, not core schema
  throws(() => parse("a: !!null x\n"), YAMLParseError);
  throws(() => jsYamlLoad("a: !!bool yes\n"), Error);
});

test("STRICTNESS: malformed !!binary content throws (documented oracle divergence — Buffer.from is lenient, we validate)", () => {
  throws(() => parse("a: !!binary |\n  aGVsbG\n"), YAMLParseError); // not a multiple of 4 after stripping whitespace
  throws(() => parse("a: !!binary |\n  !!!!\n"), YAMLParseError); // no valid base64 characters at all
});

test("STRICTNESS: an undefined %TAG handle throws (matches the oracle and js-yaml)", () => {
  throws(() => parse("!e!foo bar\n"), YAMLParseError);
  throws(() => oracleParse("!e!foo bar\n"));
  throws(() => jsYamlLoad("!e!foo bar\n"), Error);
});

test("STRICTNESS: a %TAG directive does not carry over to the next document in a stream", () => {
  // yaml-test-suite QLJ7: the second document's `!prefix!B` has no %TAG of its own.
  const text = "%TAG !prefix! tag:example.com,2011:\n--- !prefix!A\na: b\n--- !prefix!B\nc: d\n";
  throws(() => parseAll(text), YAMLParseError);
});

test("STRICTNESS: malformed tag syntax throws (unescaped flow indicator in a tag suffix)", () => {
  // yaml-test-suite LHL4.
  throws(() => parse("---\n!invalid{}tag scalar\n"), YAMLParseError);
  throws(() => oracleParse("---\n!invalid{}tag scalar\n"));
});

test("STRICTNESS: a tag not followed by a separator throws in block context (yaml-test-suite U99R)", () => {
  throws(() => parse("- !!str, xxx\n"), YAMLParseError);
  throws(() => oracleParse("- !!str, xxx\n"));
});

test("STRICTNESS: a tag mismatched with the underlying node kind throws (js-yaml semantics; documented oracle divergence)", () => {
  throws(() => parse("a: !!map\n  - 1\n  - 2\n"), YAMLParseError); // !!map on an actual sequence
  throws(() => parse("a: !!str\n  x: 1\n"), YAMLParseError); // !!str on an actual mapping
  throws(() => jsYamlLoad("a: !!map\n  - 1\n  - 2\n"), Error);
});

test("STRICTNESS: !!set requires all-null values (matches the oracle)", () => {
  throws(() => parse("--- !!set\na: something\nb: null\n"), YAMLParseError);
  throws(() => oracleParse("--- !!set\na: something\nb: null\n"));
});

test("STRICTNESS: !!omap requires exactly one key per sequence entry (matches the oracle)", () => {
  throws(() => parse("--- !!omap\n- a: 1\n  b: 2\n"), YAMLParseError);
  throws(() => oracleParse("--- !!omap\n- a: 1\n  b: 2\n"));
});

test("agrees with js-yaml on core-schema tags (valid content)", () => {
  const cases = ["a: !!str 123\n", "a: !!int 0x10\n", "a: !!float 3\n", "a: !!bool True\n", "a: !!null ~\n", "a: !!map\n  x: 1\n", "a: !!seq\n  - 1\n  - 2\n", "! 12\n"];
  for (const s of cases) deepStrictEqual(parse(s), jsYamlLoad(s));
});

test("%TAG-redefined secondary handle changes what '!!' means (yaml-test-suite P76L)", () => {
  const text = "%TAG !! tag:example.com,2000:app/\n---\n!!int 1 - 3 # Interval, not integer\n";
  deepStrictEqual(parse(text), "1 - 3"); // !!int no longer means the core int tag — an unrecognized app tag passes through
  deepStrictEqual(parse(text), oracleParse(text));
});

// ==========================================================================
// Diagnostic-and-fix pass (2026-07): oracle-divergence bug fixes.
// Each block pins the oracle-correct behavior for a bug that used to
// mis-parse or wrongly accept/reject (`oracleParseAll` defined above is the
// multi-document analogue of `oracleParse`).
// ==========================================================================

test("quoted multi-line flow folding: doubles, singles, blank lines, tab prefixes", () => {
  // yaml-test-suite TL85 / 7A4E / PRH3 / NAT4 shapes, all against the oracle.
  const cases = [
    '"\n  foo \n \n  \t bar\n\n  baz\n"\n', // TL85: " foo\nbar\nbaz "
    '" 1st non-empty\n\n 2nd non-empty \n\t3rd non-empty "\n', // 7A4E
    "' 1st non-empty\n\n 2nd non-empty \n\t3rd non-empty '\n", // PRH3 (single-quoted)
    'a: "So does this\n  quoted scalar.\\n"\n', // 4CQQ shape: trailing escaped \n
    'x: " foo\n  bar "\ny: 1\n', // multi-line value then a sibling key
  ];
  for (const s of cases) deepStrictEqual(parseAll(s), oracleParseAll(s));
  strictEqual(parse('"a\nb"'), "a b");
  strictEqual(parse("'a\n\nb'"), "a\nb");
});

test("double-quoted escaped whitespace (\\<TAB>) is literal content (yaml-test-suite KH5V/01, DE56)", () => {
  strictEqual(parse('"2 inline\\\ttab"'), "2 inline\ttab"); // backslash + literal tab → tab
  strictEqual(parse('"3 trailing\\\t\n    tab"'), "3 trailing\t tab"); // + fold
  strictEqual(parse('"2 inline\\\ttab"'), oracleParse('"2 inline\\\ttab"'));
});

test("a multi-line quoted scalar cannot be a block implicit key (yaml-test-suite 7LBH/D49Q/JKF3)", () => {
  throws(() => parse('"a\\nb": 1\n"c\n d": 1\n'), YAMLParseError); // 7LBH
  throws(() => parse("'a\\nb': 1\n'c\n d': 1\n"), YAMLParseError); // D49Q
  throws(() => parse('- - "bar\nbar": x\n'), YAMLParseError); // JKF3
  throws(() => oracleParse('"c\n d": 1\n'));
});

test("a column-0 doc marker inside a quoted scalar is unterminated (yaml-test-suite 5TRB/RXY3)", () => {
  throws(() => parse('---\n"\n---\n"\n'), YAMLParseError); // 5TRB
  throws(() => parse("---\n'\n...\n'\n"), YAMLParseError); // RXY3
  strictEqual(parse('"a\n  --- x\nb"'), "a --- x b"); // INDENTED marker is ordinary content
  strictEqual(parse('"a\n  --- x\nb"'), oracleParse('"a\n  --- x\nb"'));
});

test("empty sequence entry followed by a same-column sibling dash → null, not a nested seq (yaml-test-suite FH7J)", () => {
  deepStrictEqual(parse("-\n- x\n"), [null, "x"]);
  deepStrictEqual(parse("- a\n-\n- b\n"), ["a", null, "b"]);
  deepStrictEqual(parse("- # comment\n- x\n"), [null, "x"]); // empty dash + comment
  deepStrictEqual(parse("- -\n  - x\n"), [[null, "x"]]); // nested
  deepStrictEqual(parse("- &a\n- x\n"), [null, "x"]); // anchored empty entry
  deepStrictEqual(parse("- !!str\n- x\n"), ["", "x"]); // tagged empty entry
  // A same-column dash after a MAPPING key stays a compact sequence value.
  deepStrictEqual(parse("key:\n- a\n- b\n"), { key: ["a", "b"] });
  for (const s of ["-\n- x\n", "- a\n-\n- b\n", "- -\n  - x\n", "- &a\n- x\n", "key:\n- a\n- b\n"]) {
    deepStrictEqual(parseAll(s), oracleParseAll(s));
  }
});

test("a plain scalar does not fold across a comment (yaml-test-suite BF9H/BS4K/8XDJ)", () => {
  throws(() => parse("word1   # comment\nword2\n"), YAMLParseError); // BS4K
  throws(() => parse("key: word1\n#  xxx\n  word2\n"), YAMLParseError); // 8XDJ
  throws(() => parse("---\nplain: a\n  b # end of scalar\n      c\n"), YAMLParseError); // BF9H
  // A trailing comment on the scalar's LAST line is fine (folds, then ends).
  deepStrictEqual(parse("a\nb # comment\n"), "a b");
  deepStrictEqual(parse("a\nb # comment\n"), oracleParse("a\nb # comment\n"));
});

test("directives must be preceded by a '...' footer (yaml-test-suite 9HCY/EB22)", () => {
  throws(() => parseAll('!foo "bar"\n%TAG ! tag:example.com,2000:app/\n---\n!foo "bar"\n'), YAMLParseError); // 9HCY
  throws(() => parseAll("---\nscalar1 # comment\n%YAML 1.2\n---\nscalar2\n"), YAMLParseError); // EB22
  // Valid: a '...' footer before the directive.
  deepStrictEqual(parseAll("doc1\n...\n%YAML 1.2\n---\ndoc2\n"), ["doc1", "doc2"]);
  deepStrictEqual(parseAll("doc1\n...\n%YAML 1.2\n---\ndoc2\n"), oracleParseAll("doc1\n...\n%YAML 1.2\n---\ndoc2\n"));
});

test("a plain scalar cannot begin with a reserved indicator %/@/` (yaml-test-suite MUS6/01)", () => {
  throws(() => parse("foo: %x\n"), YAMLParseError);
  throws(() => parse("foo: @x\n"), YAMLParseError);
  throws(() => parse("foo: `x\n"), YAMLParseError);
  throws(() => parseAll("%YAML 1.2\n---\n%YAML 1.2\n---\n"), YAMLParseError); // MUS6/01
  throws(() => oracleParse("foo: @x\n"));
  // Reserved chars are fine anywhere but the first position.
  deepStrictEqual(parse("a%b\n"), "a%b");
  deepStrictEqual(parse("50%\n"), "50%");
});

test("a mapping value may not inline a block collection (yaml-test-suite ZCZ6/ZL4Z/5U3A)", () => {
  throws(() => parse("a: b: c: d\n"), YAMLParseError); // ZCZ6
  throws(() => parse("a: 'b': c\n"), YAMLParseError); // ZL4Z
  throws(() => parse("key: - a\n     - b\n"), YAMLParseError); // 5U3A
  throws(() => oracleParse("a: b: c: d\n"));
  // A SEQUENCE entry's inline value MAY be a compact mapping — still legal.
  deepStrictEqual(parse("- a: 1\n  b: 2\n"), [{ a: 1, b: 2 }]);
  deepStrictEqual(parse("key: {a: b}\nk2: [1, 2]\n"), { key: { a: "b" }, k2: [1, 2] });
});

// --------------------------------------------------------------------------
// Explicit block mapping keys (`? key` / `: value`, spec 8.17). `?`
// unambiguously opens a NEW block mapping — never a retroactive re-read of an
// already-parsed scalar the way an implicit key is — so a key/value here may
// be multi-line or a whole collection, which an implicit key can never be
// (see `parseBlockMapExplicit`/`parseExplicitValue`/`parseBlockMap` in
// src/index.ts). Every case is calibrated against the `yaml` oracle; the
// STRICTNESS cases follow js-yaml instead, per the file's established
// convention for negative cases.
// --------------------------------------------------------------------------

test("explicit block keys: basic '? k' / ': v', matching the oracle", () => {
  deepStrictEqual(parse("? a\n: b\n"), { a: "b" });
  deepStrictEqual(parse("? a\n: b\n? c\n: d\n"), { a: "b", c: "d" });
  for (const s of ["? a\n: b\n", "? a\n: b\n? c\n: d\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: '? k' with no ':' at all → null value (yaml-test-suite 7W2P)", () => {
  deepStrictEqual(parse("? a\n? b\nc:\n"), { a: null, b: null, c: null });
  deepStrictEqual(parse("? a\n"), { a: null });
  for (const s of ["? a\n? b\nc:\n", "? a\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: a bare ': v' with no preceding '?' is a null/empty key", () => {
  // Matches the `yaml` oracle's `''` convention (same as `keyToString(null)`
  // elsewhere in this file) — js-yaml instead assigns the JS value `null` as
  // an object key, which JS itself coerces to the STRING "null" on write; a
  // documented, deliberate divergence (we follow the oracle here, not js-yaml).
  deepStrictEqual(parse(": value\n"), { "": "value" });
  deepStrictEqual(parse(": value\nkey: v2\n"), { "": "value", key: "v2" });
  for (const s of [": value\n", ": value\nkey: v2\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: complex keys — a sequence or mapping AS the key", () => {
  // An implicit key can never be a collection; this is the whole point of the
  // explicit form. A collection key is rendered into the SAME flow-style
  // string the oracle's `.toJS()` uses for a non-scalar map key.
  deepStrictEqual(parse("? [a, b]\n: v\n"), { "[ a, b ]": "v" });
  deepStrictEqual(parse("? {a: 1}\n: v\n"), { "{ a: 1 }": "v" });
  deepStrictEqual(parse("?\n  - a\n  - b\n: v\n"), { "[ a, b ]": "v" }); // deferred, more-indented than '?'
  deepStrictEqual(parse("? a: 1\n  b: 2\n: v\n"), { "{ a: 1, b: 2 }": "v" }); // inline nested map as key
  deepStrictEqual(parse("? []\n: v\n"), { "[]": "v" });
  deepStrictEqual(parse("? {}\n: v\n"), { "{}": "v" });
  for (const s of ["? [a, b]\n: v\n", "? {a: 1}\n: v\n", "?\n  - a\n  - b\n: v\n", "? a: 1\n  b: 2\n: v\n", "? []\n: v\n", "? {}\n: v\n"]) {
    deepStrictEqual(parse(s), oracleParse(s));
  }
});

test("explicit block keys: a multi-line plain scalar folds into the key (yaml-test-suite JTV5)", () => {
  const s = "? a\n  true\n: null\n  d\n? e\n  42\n";
  deepStrictEqual(parse(s), { "a true": "null d", "e 42": null });
  deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: a literal block scalar as the key, inline compact seq as the value (yaml-test-suite 5WE3 — 'Explicit compact')", () => {
  const s = "? explicit key # Empty value\n? |\n  block key\n: - one # Explicit compact\n  - two # block value\n";
  deepStrictEqual(parse(s), { "explicit key": null, "block key\n": ["one", "two"] });
  deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: mixed implicit + explicit entries in one mapping (yaml-test-suite RR7F/ZWK4)", () => {
  deepStrictEqual(parse("a: 4.2\n? d\n: 23\n"), { a: 4.2, d: 23 }); // implicit then explicit
  deepStrictEqual(parse("---\na: 1\n? b\n&anchor c: 3\n"), { a: 1, b: null, c: 3 }); // explicit (no value) then anchored implicit
  for (const s of ["a: 4.2\n? d\n: 23\n", "---\na: 1\n? b\n&anchor c: 3\n"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: nested — an explicit entry inside an ordinary mapping's value (yaml-test-suite S9E8)", () => {
  const s = "sequence:\n- one\n- two\nmapping:\n  ? sky\n  : blue\n  sea : green\n";
  deepStrictEqual(parse(s), { sequence: ["one", "two"], mapping: { sky: "blue", sea: "green" } });
  deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: anchored/tagged keys and values compose (yaml-test-suite L94M/6M2F/35KP)", () => {
  deepStrictEqual(parse("? !!str a\n: !!int 47\n? c\n: !!str d\n"), { a: 47, c: "d" });
  // An anchored key AND value, then a bare second ':' (empty key) aliasing the key.
  deepStrictEqual(parse("? &a a\n: &b b\n: *a\n"), { a: "b", "": "a" });
  // A DEFERRED tag on the document root decorates the finished explicit-key map.
  deepStrictEqual(parseAll("--- !!map\n? a\n: b\n--- !!seq\n- !!str c\n--- !!str\nd\ne\n"), [{ a: "b" }, ["c"], "d e"]);
  for (const s of ["? !!str a\n: !!int 47\n? c\n: !!str d\n", "? &a a\n: &b b\n: *a\n"]) deepStrictEqual(parse(s), oracleParse(s));
  deepStrictEqual(parseAll("--- !!map\n? a\n: b\n--- !!seq\n- !!str c\n--- !!str\nd\ne\n"), oracleParseAll("--- !!map\n? a\n: b\n--- !!seq\n- !!str c\n--- !!str\nd\ne\n"));
});

test("explicit block keys: comment between the '?'/':' indicator and its content (yaml-test-suite X8DW)", () => {
  const s = "---\n? key\n# comment\n: value\n";
  deepStrictEqual(parse(s), { key: "value" });
  deepStrictEqual(parse(s), oracleParse(s));
});

test("explicit block keys: agrees with js-yaml", () => {
  const cases = ["? a\n: b\n", "? a\n? b\nc:\n", "a: 4.2\n? d\n: 23\n", "? !!str a\n: !!int 47\n? c\n: !!str d\n"];
  for (const s of cases) deepStrictEqual(parse(s), jsYamlLoad(s));
});

test("STRICTNESS: an explicit value's ':' must be at the SAME column as its '?' (bad indentation otherwise, matching js-yaml — the oracle is lenient here, a documented divergence)", () => {
  throws(() => parse("? a\n : 1\n"), YAMLParseError); // over-indented by 1
  throws(() => parse("? a\n  : 1\n"), YAMLParseError); // over-indented by 2
  throws(() => parse("outer:\n  ? a\n : 1\n"), YAMLParseError); // nested, mis-indented relative to '?'
  // A ':' that never appears at all is fine — just a null value (see 7W2P above).
  deepStrictEqual(parse("? a\n"), { a: null });
});

test("STRICTNESS: a node property may not precede '?' — it must decorate the key AFTER it", () => {
  throws(() => parse("&a ? k: v\n"), YAMLParseError);
  throws(() => parse("!!map ? a\n: b\n"), YAMLParseError);
  throws(() => oracleParse("&a ? k: v\n"));
});

test("STRICTNESS: an explicit-key mapping cannot start on the same line as '---' or an enclosing mapping key", () => {
  throws(() => parse("--- ? k\n: v\n"), YAMLParseError);
  throws(() => parse("key: ? k\n     : v\n"), YAMLParseError);
  throws(() => oracleParse("key: ? k\n     : v\n"));
});

test("STRICTNESS: a tab cannot separate '?'/explicit ':' from content that opens a new collection (yaml-test-suite Y79Y/006-009)", () => {
  throws(() => parse("?\t-\n"), YAMLParseError); // Y79Y/006
  throws(() => parse("? -\n:\t-\n"), YAMLParseError); // Y79Y/007
  throws(() => parse("?\tkey:\n"), YAMLParseError); // Y79Y/008
  throws(() => parse("? key:\n:\tkey:\n"), YAMLParseError); // Y79Y/009
  // The restriction holds for a 2ND explicit key too (the loop path), not just
  // the first — issue #17 routed both through the same `parseExplicitKey`.
  throws(() => parse("? x\n: y\n?\t- a\n: z\n"), YAMLParseError);
  throws(() => parse("? x\n: y\n?\tk: 1\n: z\n"), YAMLParseError);
  // A tab before an ORDINARY scalar (nothing collection-shaped follows) is
  // still fine — the restriction is specifically about tab-reached columns
  // that become a structural indentation reference for a NEW collection.
  deepStrictEqual(parse("?\tsimple\n: v\n"), { simple: "v" });
  deepStrictEqual(parse("? x\n: y\n?\tsimple\n: z\n"), { x: "y", simple: "z" });
});

// --------------------------------------------------------------------------
// Flow-context multi-line PLAIN scalar folding (yaml-test-suite 8KB6, 8UDB,
// CT4Q, UT92, NJ66). A plain scalar spanning lines INSIDE a flow collection
// folds like block-plain: a single break → space, blank line → newline, and
// per-line leading/trailing whitespace is stripped.
// --------------------------------------------------------------------------

test("flow plain fold: a multi-line plain key with no value (yaml-test-suite 8KB6)", () => {
  const s = "---\n- { single line, a: b}\n- { multi\n  line, a: b}\n";
  deepStrictEqual(parse(s), [
    { "single line": null, a: "b" },
    { "multi line": null, a: "b" },
  ]);
  deepStrictEqual(parse(s), oracleParse(s));
});

test("flow plain fold: a multi-line plain key WITH a value (yaml-test-suite NJ66)", () => {
  const s = "---\n- { single line: value}\n- { multi\n  line: value}\n";
  deepStrictEqual(parse(s), [{ "single line": "value" }, { "multi line": "value" }]);
  deepStrictEqual(parse(s), oracleParse(s));
});

test("flow plain fold: multi-line plain values and an explicit key fold across lines (yaml-test-suite 8UDB, CT4Q)", () => {
  const udb = '[\n"double\n quoted", \'single\n           quoted\',\nplain\n text, [ nested ],\nsingle: pair,\n]\n';
  deepStrictEqual(parse(udb), ["double quoted", "single quoted", "plain text", ["nested"], { single: "pair" }]);
  deepStrictEqual(parse(udb), oracleParse(udb));
  const ct4q = "[\n? foo\n bar : baz\n]\n";
  deepStrictEqual(parse(ct4q), [{ "foo bar": "baz" }]);
  deepStrictEqual(parse(ct4q), oracleParse(ct4q));
});

test("flow plain fold: a col-0 plain continuation across a flow mapping key (yaml-test-suite UT92)", () => {
  const s = "---\n{ matches\n% : 20 }\n...\n---\n# Empty\n...\n";
  deepStrictEqual(parseAll(s), [{ "matches %": 20 }, null]);
  deepStrictEqual(parseAll(s), oracleParseAll(s));
});

// --------------------------------------------------------------------------
// Flow single-pair implicit keys must be on ONE line (yaml-test-suite DK4H,
// ZXT5) — a flow SEQUENCE pair whose ':' lands on a later line than the key is
// invalid. A flow MAPPING implicit entry may span lines (`{a\n: b}` is legal),
// so the restriction is scoped to sequence pairs only.
// --------------------------------------------------------------------------

test("STRICTNESS: a flow-sequence single-pair implicit key must be on one line (yaml-test-suite DK4H, ZXT5)", () => {
  for (const s of ["---\n[ key\n  : value ]\n", '[ "key"\n  :value ]\n']) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // A flow MAPPING implicit key MAY span onto the ':' line — still valid.
  deepStrictEqual(parse("{a\n: b}\n"), { a: "b" });
  deepStrictEqual(parse("{a\n: b}\n"), oracleParse("{a\n: b}\n"));
});

test("STRICTNESS: a multi-line flow collection cannot be a block mapping key (yaml-test-suite C2SP)", () => {
  throws(() => parse("[23\n]: 42\n"), YAMLParseError);
  throws(() => oracleParse("[23\n]: 42\n"));
  // A single-line flow collection key is fine.
  deepStrictEqual(parse("[a, b]: v\n"), oracleParse("[a, b]: v\n"));
});

// --------------------------------------------------------------------------
// Flow / quoted continuation lines must out-indent the enclosing block node
// (yaml-test-suite 9C9N, VJP3/00, QB6E). At the document root (no floor) col 0
// is legal, so top-level multi-line flow/quoted scalars keep working.
// --------------------------------------------------------------------------

test("STRICTNESS: a nested flow collection's continuation lines must be sufficiently indented (yaml-test-suite 9C9N, VJP3/00)", () => {
  for (const s of ["---\nflow: [a,\nb,\nc]\n", "k: {\nk\n:\nv\n}\n"]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // Sufficiently-indented continuations, and a top-level flow (no floor), are OK.
  deepStrictEqual(parse("flow: [a,\n b,\n c]\n"), oracleParse("flow: [a,\n b,\n c]\n"));
  deepStrictEqual(parse("[a,\nb,\nc]\n"), oracleParse("[a,\nb,\nc]\n"));
});

test("STRICTNESS: a nested multi-line quoted scalar's continuation lines must be sufficiently indented (yaml-test-suite QB6E)", () => {
  throws(() => parse('---\nquoted: "a\nb\nc"\n'), YAMLParseError);
  throws(() => oracleParse('---\nquoted: "a\nb\nc"\n'));
  // A top-level multi-line quoted scalar (no floor) still folds fine.
  deepStrictEqual(parse('"a\nb\nc"\n'), oracleParse('"a\nb\nc"\n'));
});

// --------------------------------------------------------------------------
// Comment separation (yaml-test-suite SU5Z, CVW2, 9JBA): a '#' begins a
// comment only at line start or when preceded by whitespace — never butting up
// against the preceding token.
// --------------------------------------------------------------------------

test("STRICTNESS: a comment must be separated from the preceding token by whitespace (yaml-test-suite SU5Z, CVW2, 9JBA)", () => {
  for (const s of ['key: "value"# invalid comment\n', "---\n[ a, b, c,#invalid\n]\n", "---\n[ a, b, c, ]#invalid\n"]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // A properly-separated comment is still accepted.
  deepStrictEqual(parse('key: "value" # ok\n'), { key: "value" });
  deepStrictEqual(parse("[a, b] # ok\n"), ["a", "b"]);
});

// --------------------------------------------------------------------------
// Miscellaneous flow strictness (yaml-test-suite N782, YJV2, G5U8): a document
// marker cannot appear inside a flow collection, and a '-' that opens a block
// sequence indicator is forbidden inside flow.
// --------------------------------------------------------------------------

test("STRICTNESS: a document marker cannot appear inside a flow collection (yaml-test-suite N782)", () => {
  throws(() => parse("[\n--- ,\n...\n]\n"), YAMLParseError);
  throws(() => oracleParse("[\n--- ,\n...\n]\n"));
});

test("STRICTNESS: a block-sequence '-' indicator is not allowed inside a flow collection (yaml-test-suite YJV2, G5U8)", () => {
  for (const s of ["[-]\n", "---\n- [-, -]\n"]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // A '-' that is part of a scalar (a negative number, or `-x`) stays fine.
  deepStrictEqual(parse("[-1, -x]\n"), oracleParse("[-1, -x]\n"));
});

// --------------------------------------------------------------------------
// Tabs as indentation (yaml-test-suite 4EJS, Y79Y/003-005): a tab may separate
// tokens but must never sit in the mandatory indentation of a line — nor indent
// a block-sequence entry that opens a new collection.
// --------------------------------------------------------------------------

test("STRICTNESS: a tab cannot be used as block indentation (yaml-test-suite 4EJS)", () => {
  throws(() => parse("---\na:\n\tb:\n\t\tc: value\n"), YAMLParseError);
  throws(() => oracleParse("---\na:\n\tb:\n\t\tc: value\n"));
  throws(() => parse("foo:\n\tbar\n"), YAMLParseError); // even a plain-scalar value
  // A tab AFTER the space indentation is ordinary separation — still valid.
  deepStrictEqual(parse("foo:\n \tbar\n"), oracleParse("foo:\n \tbar\n"));
});

test("STRICTNESS: a tab cannot indent a block-sequence entry that opens a new collection (yaml-test-suite Y79Y/004, Y79Y/005)", () => {
  for (const s of ["-\t-\n", "- \t-\n"]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // A tab before an inline SCALAR seq entry is fine (it's separation).
  deepStrictEqual(parse("-\t-1\n"), oracleParse("-\t-1\n"));
});

test("STRICTNESS: a tab cannot indent a flow continuation line (yaml-test-suite Y79Y/003)", () => {
  throws(() => parse("- [\n\tfoo,\n foo\n ]\n"), YAMLParseError);
  throws(() => oracleParse("- [\n\tfoo,\n foo\n ]\n"));
  // A tab on a BLANK line inside the flow is fine (yaml-test-suite Y79Y/002).
  deepStrictEqual(parse("- [\n\t\n foo\n ]\n"), oracleParse("- [\n\t\n foo\n ]\n"));
});

// --------------------------------------------------------------------------
// Space-then-tab positioning a block collection (issue #18 — a deeper 4EJS
// manifestation). `" \t"` is byte-identical whether it precedes a block
// map/seq (illegal indentation, must throw) or a folding plain scalar / flow
// collection / alias (legal separation), so the rejection is gated on the
// produced node being a BLOCK collection — a purely lexical scan cannot tell
// the two apart. Root-level input and continuation entries are covered too, as
// neither flows through the ordinary deferred-node tab guard.
// --------------------------------------------------------------------------

test("STRICTNESS: a space-then-tab cannot indent a deferred or root block collection (issue #18, yaml-test-suite 4EJS)", () => {
  for (const s of [
    dedent`
    a:
     \tb: 1
    `, // deferred block MAP
    dedent`
    a:
     \t- 1
    `, // deferred block SEQ
    dedent`
     \ta: 1
    `, // ROOT block MAP
    dedent`
    \t- 1
    `, // ROOT block SEQ
    dedent`
    a:
     \t- b: 1
    `, // deferred compact seq-of-map
  ]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // The identical `" \t"` bytes stay legal before content that is NOT a block
  // collection — a folding plain scalar, a flow collection VALUE, a quoted
  // scalar, or an alias (even one resolving to a collection): tab as separation.
  for (const y of [
    dedent`
    foo:
     \tbar
    `,
    dedent`
    a:
     \t[1, 2]
    `,
    dedent`
    a:
     \t{b: 1}
    `,
    dedent`
    a:
     \t"x"
    `,
    dedent`
    x: &a [1]
    b:
     \t*a
    `,
  ]) {
    deepStrictEqual(parse(y), oracleParse(y));
  }
});

test("STRICTNESS: a space-then-tab cannot indent a block-collection continuation entry (issue #18)", () => {
  for (const s of [
    dedent`
    foo:
      a: 1
     \tb: 2
    `, // block-map continuation KEY
    dedent`
    m:
      k1: v1
     \tk2: v2
      k3: v3
    `, // block-map middle key
    dedent`
    top:
      x: 1
      y:
        m: 1
     \tn: 2
    `, // continuation after a nested dedent
    dedent`
    a:
      - 1
     \t- 2
    `, // block-seq continuation entry
  ]) {
    throws(() => parse(s), YAMLParseError);
    throws(() => oracleParse(s));
  }
  // Space-only continuations are unaffected.
  for (const y of [
    dedent`
    foo:
      a: 1
      b: 2
    `,
    dedent`
    a:
      - 1
      - 2
    `,
  ]) {
    deepStrictEqual(parse(y), oracleParse(y));
  }
});

test("skipStrictValidation option: opting in skips the strict-compliance (tab-indent) guards, accepting input the default rejects (issue #18)", () => {
  const skip = { optimizations: { skipStrictValidation: true } };
  const tabIndented = "a:\n \tb: 1\n"; // space-then-tab positioning a nested block map
  // Default: spec-compliant rejection (as the STRICTNESS tests above assert).
  throws(() => parse(tabIndented), YAMLParseError);
  throws(() => parseAll(tabIndented), YAMLParseError);
  // Opted out: the guard is skipped, so the (spec-invalid) input parses to the
  // lenient value instead of throwing.
  deepStrictEqual(parse(tabIndented, skip), { a: { b: 1 } });
  deepStrictEqual(parseAll(tabIndented, skip), [{ a: { b: 1 } }]);
  // VALID input parses identically with the option on or off — the guards only
  // ever throw, never transform.
  for (const y of ["a:\n  b: 1\n", "a:\n  - 1\n  - 2\n", "foo:\n \tbar\n", "x: [1, 2]\n"]) {
    deepStrictEqual(parse(y, skip), parse(y));
  }
  // The option is per-call and does not leak: a default parse after a skip parse
  // still rejects.
  throws(() => parse(tabIndented), YAMLParseError);
});

// --------------------------------------------------------------------------
// A node can have at most one anchor (yaml-test-suite 4JVG): a deferred anchor
// whose node begins with its OWN anchor and resolves to a scalar/non-mapping
// collection is a two-anchor conflict — but an inner anchor on a mapping KEY is
// a distinct node from the map the outer anchor decorates (yaml-test-suite 7BMT).
// --------------------------------------------------------------------------

test("STRICTNESS: a scalar/collection cannot carry two anchors via a deferred property (yaml-test-suite 4JVG)", () => {
  throws(() => parse("top1: &node1\n  &k1 key1: val1\ntop2: &node2\n  &v2 val2\n"), YAMLParseError);
  throws(() => oracleParse("top1: &node1\n  &k1 key1: val1\ntop2: &node2\n  &v2 val2\n"));
  // The 7BMT shape — inner anchor on the KEY, outer on the MAP — stays valid.
  deepStrictEqual(parse("top: &node1\n  &k1 key1: v\n"), oracleParse("top: &node1\n  &k1 key1: v\n"));
});

// --------------------------------------------------------------------------
// UTF-8 / emoji handling. The parser scans by UTF-16 code unit (`charCodeAt`)
// and slices scalar spans out of the source, so the risk is a multi-byte or
// astral character being split at a scalar boundary. A BMP char like `é`/`中`
// is one code unit but 2–3 UTF-8 bytes; an emoji like `😀` is a surrogate PAIR
// (two code units, 4 UTF-8 bytes) — the case most likely to break a naive
// scanner. The official yaml-test-suite only exercises BMP text in a plain
// scalar value (H3Z8) / comment (P2AD) and one astral emoji in an anchor name
// (8XYN); it never puts an astral emoji in a scalar value/key, a block scalar
// body, or a quoted string. These fill that gap, asserting exact values and
// cross-checking the oracle.
// --------------------------------------------------------------------------

const utf8Cases: [string, string, unknown][] = [
  // astral emoji in a plain (unquoted) scalar value and key — not in the suite
  ["plain value", "greeting: héllo 🎉 wörld", { greeting: "héllo 🎉 wörld" }],
  ["plain key", "café ☕ 🔑: yes", { "café ☕ 🔑": "yes" }],
  ["emoji-only key and value", "🔑: 🎉", { "🔑": "🎉" }],
  // literal (unescaped) multibyte + astral inside quoted scalars
  ["single-quoted", "s: 'naïve 🎈 façade'", { s: "naïve 🎈 façade" }],
  ["double-quoted", 's: "naïve 🎈 façade"', { s: "naïve 🎈 façade" }],
  // block literal / folded scalar BODIES (suite only tests BMP in the header)
  [
    "block literal |",
    "text: |\n  line one 🎉\n  héllo λ\n  日本語\n",
    { text: "line one 🎉\nhéllo λ\n日本語\n" },
  ],
  ["block folded >", "text: >\n  wörld 🎈\n  café λ\n", { text: "wörld 🎈 café λ\n" }],
  // flow collections
  ["flow map", "{ café: ☕, 日本: 語 }", { café: "☕", 日本: "語" }],
  ["flow seq", "[🍎, 🍊, λ, π]", ["🍎", "🍊", "λ", "π"]],
  // astral pair immediately adjacent to a flow delimiter (boundary stress)
  ["astral adjacent to delimiter", "[a🎉,b🎈]", ["a🎉", "b🎈"]],
  // a long run mixing BMP and astral, no ASCII separators to lean on
  ["mixed BMP + astral run", "s: αβγ😀😁😂中文", { s: "αβγ😀😁😂中文" }],
  // ZWJ-joined and regional-indicator (flag) emoji stay byte-for-byte intact
  ["ZWJ family emoji", "s: 👨‍👩‍👧‍👦 family", { s: "👨‍👩‍👧‍👦 family" }],
  ["flag emoji", "s: 🇬🇧 🇯🇵", { s: "🇬🇧 🇯🇵" }],
  // emoji surviving a trailing comment (comment is dropped, scalar is not)
  ["emoji before comment", "a: café 🎉 # 日本 comment", { a: "café 🎉" }],
];

for (const [label, input, expected] of utf8Cases) {
  test(`utf8/emoji · ${label}`, () => {
    deepStrictEqual(parse(input), expected);
    deepStrictEqual(parse(input), oracleParse(input));
  });
}

test("utf8/emoji · astral emoji in an anchor name resolves through its alias", () => {
  // yaml-test-suite 8XYN covers an astral anchor NAME; this adds the alias hop.
  deepStrictEqual(parse("- &😁 first\n- *😁\n"), ["first", "first"]);
  deepStrictEqual(parse("- &😁 first\n- *😁\n"), oracleParse("- &😁 first\n- *😁\n"));
});

test("utf8/emoji · stringify round-trips multibyte and astral text", () => {
  const value = {
    greeting: "héllo 🎉 wörld",
    日本語: ["λ", "π", "😀😁"],
    nested: { "☕": "café", "🔑": "🎈" },
  };
  deepStrictEqual(parse(stringify(value)), value);
});

// --------------------------------------------------------------------------
// T7 — opt-in value interning: parse(text, { optimizations: { internStrings } }).
// Interning collapses equal string VALUES to one shared heap instance; because JS
// strings are immutable it is CORRECTNESS-INVISIBLE — the flag never changes the
// parsed value, only its retained heap. (Instance sharing itself is not
// observable from JS: `===` on strings is VALUE equality, so it can't distinguish
// shared from unshared. The heap saving is proven by the benchmark in the T7
// research/result notes, not here.) OFF by default, so every options shape must
// parse identically to no options. See site/src/content/docs/research/notes/2026-07-14-memory-value-interning.md.
// --------------------------------------------------------------------------

// Block-style record array whose string values are drawn from tiny pools, so the
// same value text recurs across rows. Single-line block plain values route
// through resolvePlain — one of the interned materialisation sites.
const internDoc = (() => {
  const status = ["active", "pending", "closed"];
  const region = ["north", "south", "east", "west"];
  let out = "";
  for (let i = 0; i < 40; i++) {
    out += `- status: ${status[i % status.length]}\n  region: ${region[i % region.length]}\n  seq: ${i}\n`;
  }
  return out;
})();

test("value interning: every options shape parses identically to no options (default OFF)", () => {
  const base = parse(internDoc);
  deepStrictEqual(parse(internDoc, {}), base);
  deepStrictEqual(parse(internDoc, { optimizations: {} }), base);
  deepStrictEqual(parse(internDoc, { optimizations: { internStrings: false } }), base);
  deepStrictEqual(parse(internDoc, { optimizations: { internStrings: true } }), base);
});

test("value interning: flag ON is byte-shape identical to flag OFF, with correct values", () => {
  const off = parse(internDoc) as Array<Record<string, unknown>>;
  const on = parse(internDoc, { optimizations: { internStrings: true } }) as Array<Record<string, unknown>>;
  deepStrictEqual(on, off); // correctness-invisible: identical data both ways
  // Repeated pool values still carry the right text under interning.
  strictEqual(on[0].status, "active");
  strictEqual(on[3].status, "active");
  strictEqual(on[0].region, "north");
  strictEqual(on[4].region, "north");
});

test("value interning: parseAll accepts options and stays correctness-invisible across documents", () => {
  const stream = "---\ns: shared\n---\ns: shared\n";
  const off = parseAll(stream);
  const on = parseAll(stream, { optimizations: { internStrings: true } });
  deepStrictEqual(on, off);
  deepStrictEqual(on, [{ s: "shared" }, { s: "shared" }]);
});

for (const ds of datasets.filter((d) => d.category === "yaml-plain")) {
  test(`value interning: fixture round-trips identically with the flag on · ${ds.name}`, () => {
    const text = loadFixtureText(ds);
    deepStrictEqual(parse(text, { optimizations: { internStrings: true } }), parse(text));
  });
}

// --------------------------------------------------------------------------
// keyCache cap (#136): mostly-distinct mapping keys must still parse correctly
// once the per-parse key-intern cache stops growing past MAX_KEY_CACHE. This
// pins correctness only — the cap's memory behaviour mirrors the already-proven
// sibling caches (valueCache/dumpKeyCache), so no multi-million-key test here.
// --------------------------------------------------------------------------

test("mostly-distinct mapping keys all parse to the right key/value pairs", () => {
  const n = 500;
  let doc = "";
  for (let i = 0; i < n; i++) doc += `key-${i}: value-${i}\n`;
  const result = parse(doc) as Record<string, string>;
  strictEqual(Object.keys(result).length, n);
  for (let i = 0; i < n; i++) strictEqual(result[`key-${i}`], `value-${i}`);
});
