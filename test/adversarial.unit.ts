/**
 * Adversarial / torture tests — the parser under hostile and spec-corner input.
 *
 * Distinct from `parser.unit.ts` (feature coverage) and the vitest consistency
 * suite (fixture-vs-oracle): this file is the differential + fuzz seedbank
 * distilled from `site/src/content/docs/research/notes/2026-07-12-adversarial-torture-tests.md`, which taxonomizes
 * the constructs known to break or split YAML parsers (parser-differential
 * research, the official yaml-test-suite corners, and real CVEs).
 *
 * Two properties are tracked SEPARATELY (per that research doc):
 *   (a) conformance — `parse` matches the YAML 1.2 SPEC (as operationalized by the
 *       spec-derived yaml-test-suite). The `yaml` implementation is a differential
 *       aid, not the definition of correct: where it diverges from spec, spec wins.
 *   (b) robustness — malformed bytes only ever raise our declared `YAMLParseError`,
 *       never an uncaught `TypeError`/`RangeError`/stack overflow (the "no
 *       unexpected exception" oracle from the Atheris fuzzing technique).
 *
 * Two spec-corner behaviours are locked below, each with its rationale:
 *   - duplicate keys are last-wins (JSON.parse semantics) — our one DELIBERATE
 *     deviation from spec (the spec, and the `yaml` impl, treat duplicates as error);
 *   - an IMPLICIT non-scalar key in a *flow* mapping (`{[1,2]: v}`) is a controlled
 *     throw — which is SPEC-CORRECT (suite SBG9/X38W); the `yaml` impl is the one
 *     that diverges by accepting it. The explicit `{? [1,2]: v}` form IS accepted.
 *
 * Run: node --import tsx --test test/adversarial.unit.ts
 */

import { test } from "node:test";
import { deepStrictEqual, throws, strictEqual, ok } from "node:assert";
import { parse, parseAll, stringify, YAMLParseError } from "../src/index.ts";
import { oracleParse } from "../bench/oracle.ts";

// C1/C0 code points that can't be written as literals in this source without
// tripping tooling — built by value instead.
const NEL = String.fromCharCode(0x85); // U+0085 NEL
const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR

// Assert a SPECIFIC error cause, not merely "some" YAMLParseError. Every parser
// error is a YAMLParseError, so a bare `throws(fn, YAMLParseError)` would still
// pass if the input later started throwing for an unrelated reason — masking a
// behaviour change on exactly the divergence/limitation rows we mean to pin.
const throwsBecause = (fn: () => unknown, cause: RegExp) =>
  throws(fn, (e: unknown) => e instanceof YAMLParseError && cause.test(e.message));

// --------------------------------------------------------------------------
// Robustness — the "no unexpected exception" oracle. For ANY byte sequence the
// parser must either return a value or throw YAMLParseError; anything else
// (RangeError from stack overflow, TypeError, …) is a bug. Covers §4 truncation,
// resource, and control-char cases plus deliberate garbage.
// --------------------------------------------------------------------------

const pathological: [string, string][] = [
  ["deep-flow-seq", "[".repeat(5000) + "]".repeat(5000)],
  ["deep-flow-map", "{a:".repeat(5000)],
  ["deep-block-seq", Array.from({ length: 5000 }, (_, i) => "  ".repeat(i) + "- x").join("\n")],
  ["deep-alias-nest", "&a [" + "[".repeat(3000)],
  ["truncated-dquote", '"' + "a".repeat(200)],
  ["truncated-squote", "'" + "a".repeat(200)],
  ["truncated-block-scalar", "|\n" + "  x".repeat(50)],
  ["lone-indicators", ": : : : - - - ? ? ?"],
  ["unbalanced-flow", "[a, {b: [c, {d: "],
  ["all-colons", ":".repeat(3000)],
  ["all-dashes", "-".repeat(3000)],
  ["all-questions", "?".repeat(3000)],
  ["huge-int", "x: " + "9".repeat(5000)],
  ["huge-float", "x: 1." + "0".repeat(5000) + "e999999"],
  ["many-anchors", Array.from({ length: 2000 }, (_, i) => `k${i}: &a${i} v`).join("\n")],
  ["alias-loop", "a: &a [*a]"],
  ["self-map", "a: &a {b: *a}"],
  ["nul-bytes", "a: \x00\x00\x00"],
  ["cr-only", "a: 1\rb: 2"],
  ["mixed-newlines", "a: 1\r\nb: 2\n\rc: 3"],
  ["high-surrogate", 'x: "\uD800"'],
  ["invalid-escapes", 'x: "\\q\\z\\9"'],
  ["tag-soup", "!!!! !<> !a!b!c x"],
  ["directive-soup", "%%%%\n%YAML\n%TAG\n---"],
  ["empty", ""],
  ["only-whitespace", "   \n\t\n   "],
  ["only-comment", "# just a comment"],
  ["doc-markers-only", "---\n---\n...\n---\n..."],
  ["explicit-key-no-value", "? a\n? b\n? c"],
  ["weird-indent-jumps", "a:\n      b:\n  c:\n         d:"],
  ["control-line-seps", `a: x${NEL}b: y${LS}c: z`],
];

for (const [name, input] of pathological) {
  test(`robust: only YAMLParseError (never a crash) · ${name}`, () => {
    for (const run of [() => parse(input), () => parseAll(input)]) {
      try {
        const v = run();
        // If it parsed, the dumper must be equally robust on the result.
        try { stringify(v); } catch (e) { ok(e instanceof YAMLParseError, `stringify threw non-YAMLParseError: ${e}`); }
      } catch (e) {
        ok(e instanceof YAMLParseError, `${name}: expected YAMLParseError, got ${(e as Error).constructor.name}: ${(e as Error).message}`);
      }
    }
  });
}

// --------------------------------------------------------------------------
// §4.1 Implicit typing / the Norway Problem.
// 1.2 core keeps yes/no/on/off/y/n as strings; only true|false|null (exact) type.
// Norway VALUES are covered in parser.unit.ts; the NEW lock here is bool-words
// used as KEYS staying DISTINCT (not collapsing true≡yes≡on into one key).
// --------------------------------------------------------------------------

test("Norway: bool-words as keys stay distinct strings (no collapse)", () => {
  const y = "true: a\nyes: b\non: c\nno: d\noff: e";
  const r = parse(y) as Record<string, unknown>;
  deepStrictEqual(r, { true: "a", yes: "b", on: "c", no: "d", off: "e" });
  strictEqual(Object.keys(r).length, 5, "five distinct keys");
  deepStrictEqual(parse(y), oracleParse(y));
});

test("Norway: country codes incl. NO stay strings", () => {
  const y = "[GB, IE, NO, no, No]";
  deepStrictEqual(parse(y), ["GB", "IE", "NO", "no", "No"]);
  deepStrictEqual(parse(y), oracleParse(y));
});

// --------------------------------------------------------------------------
// §4.2 Number coercion boundary. Adds the exact literals the research doc calls
// out that parser.unit.ts lacked: `010` (decimal 10 in 1.2 core, NOT octal 8),
// and `-_` (the Atheris case that made PyYAML raise ValueError — must be a
// harmless string for us, never a throw).
// --------------------------------------------------------------------------

test("numbers: 1.2-core boundary literals resolve per the active schema", () => {
  const cases: [string, unknown][] = [
    ["010", 10], // decimal with leading zero — NOT 1.1 octal (8)
    ["0o17", 15], // 1.2 octal
    ["0xFF", 255],
    ["007", 7],
    ["8_000", "8_000"], // underscores are a 1.1 feature — string in 1.2 core
    ["0b1010", "0b1010"], // binary is 1.1-only — string in 1.2 core
    ["22:22:22", "22:22:22"], // sexagesimal is 1.1-only — string in 1.2 core
    ["-_", "-_"], // malformed numeric → string, NEVER an exception (Atheris)
    ["+_", "+_"],
    [".", "."],
  ];
  for (const [text, expected] of cases) {
    const y = `v: ${text}`;
    deepStrictEqual(parse(y), { v: expected }, `parse(${JSON.stringify(y)})`);
    deepStrictEqual(parse(y), oracleParse(y), `oracle agrees on ${JSON.stringify(y)}`);
  }
});

// --------------------------------------------------------------------------
// §4.3 Duplicate keys — DELIBERATE DIVERGENCE.
// lightning-yaml's north star is JSON.parse, which is last-wins:
// JSON.parse('{"a":1,"a":2}') === {a:2}. The `yaml` oracle instead REJECTS
// duplicate keys ("Map keys must be unique"). We lock last-wins AND assert the
// oracle diverges, so the policy (src/index.ts assignPair) is pinned. This is
// the security-relevant differential the research doc flags (CVE-2017-12635
// class: two parsers disagreeing on duplicate keys).
// --------------------------------------------------------------------------

test("duplicate keys: last-wins (JSON.parse semantics), diverging from the oracle", () => {
  deepStrictEqual(parse("lang: X\nlang: Y"), { lang: "Y" }, "block form");
  deepStrictEqual(parse("{a: 1, a: 2}"), { a: 2 }, "flow form");
  deepStrictEqual(parse('{"a": 1, "a": 2}'), JSON.parse('{"a": 1, "a": 2}'), "matches JSON.parse");
  // The oracle rejects what we accept — this is the documented divergence.
  throws(() => oracleParse("lang: X\nlang: Y"), "oracle rejects duplicate keys");
});

// --------------------------------------------------------------------------
// §4.4/§4.5/§4.9 Merge keys `<<`. Merge is UNIMPLEMENTED by design (a documented
// non-goal; `<<` was removed from YAML 1.2 and is absent from the test corpus).
// The behaviour is NOT a throw and NOT a merge: `<<` is read as a plain, literal
// string key — which is exactly what the `yaml` oracle does by default (its
// merge support is opt-in). We lock the literal-key reading so it can't silently
// change, and confirm the flagship four-parser payload does not crash.
// --------------------------------------------------------------------------

test("merge key `<<` is read as a literal string key, not merged", () => {
  deepStrictEqual(parse("<<: hello\nn: 1"), { "<<": "hello", n: 1 });
  const y = "base: &b {a: 1, b: 2}\nderived:\n  <<: *b\n  b: 3";
  deepStrictEqual(parse(y), { base: { a: 1, b: 2 }, derived: { "<<": { a: 1, b: 2 }, b: 3 } });
  deepStrictEqual(parse(y), oracleParse(y), "oracle also treats `<<` as a literal key by default");
});

test("merge: DarkForge four-parser payload does not crash (merge unimplemented)", () => {
  const y = `<<: {?"lang": Go, !!merge : {lang: NodeJS}}\ndfl: &morge "<<"\n*morge : {lang: RUBY}\n!!merge : {lang: PYTHON}`;
  const r = parse(y);
  ok(r !== null && typeof r === "object", "parses to an object without throwing");
});

// --------------------------------------------------------------------------
// §4.12 Complex (non-scalar) mapping keys — SPEC is the oracle here.
// A collection used as a key needs the explicit `?` indicator, so the EXPLICIT
// forms (block `? [a,b]`, flow `{? [1,2]: v}`) are valid and we accept them;
// the IMPLICIT flow form `{[1,2]: v}` is a spec ERROR — yaml-test-suite SBG9
// (`{a: [b,c], [d,e]: f}`) and X38W mark it so. We match the spec on both sides.
// The `yaml` implementation diverges: it accepts the implicit form (which is why
// it fails SBG9/X38W, 89/91 negatives, while we pass 91/91). So this is NOT our
// limitation — treating that implementation as the oracle would wrongly flag our
// correct rejection as a bug.
// --------------------------------------------------------------------------

test("complex keys: EXPLICIT `?` collection key (block + flow) is accepted per spec", () => {
  deepStrictEqual(parse("? [a, b]\n: v"), { "[ a, b ]": "v" }); // block
  deepStrictEqual(parse("? [a, b]\n: v"), oracleParse("? [a, b]\n: v"));
  deepStrictEqual(parse("? {a: 1}\n: v"), oracleParse("? {a: 1}\n: v"));
  deepStrictEqual(parse("{? [1, 2]: v}"), { "[ 1, 2 ]": "v" }); // explicit flow
  deepStrictEqual(parse("{? [1, 2]: v}"), oracleParse("{? [1, 2]: v}"));
});

test("complex keys: IMPLICIT flow collection key is a spec error — we reject it (impl diverges)", () => {
  // yaml-test-suite SBG9 / X38W: a flow collection used as an implicit key is an error.
  throwsBecause(() => parse("{[1, 2]: v}"), /mapping key/);
  throwsBecause(() => parse("{{a: 1}: v}"), /mapping key/);
  throwsBecause(() => parse("{a: [b, c], [d, e]: f}"), /mapping key/); // SBG9
  // The `yaml` implementation diverges from spec by accepting it — pinned so the
  // differential stays visible (one of the 2 suite negatives that implementation fails).
  deepStrictEqual(oracleParse("{[1, 2]: v}"), { "[ 1, 2 ]": "v" });
});

// --------------------------------------------------------------------------
// §4.10 Anchor/alias resource bombs (billion laughs, quadratic blowup).
// lightning-yaml resolves an alias to the SAME reference (structural sharing,
// O(1) Map.get — never a deep copy), so an exponential alias bomb builds a small
// shared-reference DAG, not a materialized 10^9-node tree: it parses in constant
// memory and near-zero time. (A downstream consumer that expands the DAG — e.g.
// JSON.stringify — is the caller's concern, same as the `yaml` oracle.)
// --------------------------------------------------------------------------

test("billion laughs: exponential alias bomb parses cheaply via structural sharing", () => {
  const levels = "abcdefghij"; // 10 levels ⇒ 9^9 ≈ 387M logical nodes if expanded
  let src = 'a: &a ["x","x","x","x","x","x","x","x","x"]\n';
  for (let i = 1; i < levels.length; i++) {
    src += `${levels[i]}: &${levels[i]} [${Array(9).fill("*" + levels[i - 1]).join(",")}]\n`;
  }
  const r = parse(src) as Record<string, unknown[]>;
  // Aliased children are the SAME object — proof nothing was materialized.
  strictEqual(r.j[0], r.j[1], "sibling aliases share one reference");
  strictEqual((r.j[0] as unknown[])[0], (r.j[1] as unknown[])[0], "sharing is deep");
  strictEqual(r.b[0], r.a, "level b aliases point at level a's array");
});

test("cyclic anchors resolve to a self-referential structure without crashing", () => {
  const seq = parse("a: &a [*a]") as { a: unknown[] };
  strictEqual(seq.a[0], seq.a, "sequence contains itself");
  const map = parse("a: &a {self: *a}") as { a: { self: unknown } };
  strictEqual(map.a.self, map.a, "map contains itself");
});

// --------------------------------------------------------------------------
// §4.18 Unicode line breaks NEL (U+0085) / LS (U+2028) / PS (U+2029), and the
// exotic double-quote escapes `\N` / `\L` / `\P`. In YAML 1.2 only LF and CR are
// line breaks; NEL/LS/PS are ordinary content. Lock both the literal-character
// and the escaped forms against the oracle.
// --------------------------------------------------------------------------

test("unicode: literal NEL/LS/PS are content, not line breaks", () => {
  for (const [name, ch] of [["NEL", NEL], ["LS", LS], ["PS", PS]] as const) {
    const y = `v: a${ch}b`;
    const r = parse(y) as { v: string };
    strictEqual(r.v, `a${ch}b`, `${name} preserved as content`);
    deepStrictEqual(parse(y), oracleParse(y), `oracle agrees on literal ${name}`);
  }
});

test("unicode: `\\N` `\\L` `\\P` double-quote escapes decode to U+0085/U+2028/U+2029", () => {
  const y = 'v: "x\\Ny\\Lz\\P"';
  deepStrictEqual(parse(y), { v: `x${NEL}y${LS}z${PS}` });
  deepStrictEqual(parse(y), oracleParse(y));
});

// --------------------------------------------------------------------------
// §4.19 Anchor edge cases — reinforce the empty/forward/redefine trio as a group.
// --------------------------------------------------------------------------

test("anchors: empty anchor aliases to null; redefinition is last-wins; forward ref throws", () => {
  deepStrictEqual(parse("x: &e\ny: *e"), { x: null, y: null }, "alias to empty node ⇒ null");
  deepStrictEqual(parse("p: &a 1\nq: &a 2\nr: *a"), { p: 1, q: 2, r: 2 }, "redefinition last-wins");
  throwsBecause(() => parse("x: *later\nlater: &later 1"), /unresolved alias/); // forward reference is illegal
});

// --------------------------------------------------------------------------
// Tab indentation strictness in block plain scalars — YAML 1.2 §5.5 / §6.1
// (a tab may not appear in a block node's MANDATORY indentation; cf. yaml-test-
// suite 4EJS). PR #29: a tab in the indentation of a multi-line plain-scalar
// CONTINUATION line was silently folded away in the no-colon case, and the
// colon case reported a misleading "mapping value not allowed" instead of the
// tab error. `checkNoTabIndent(parentCol)` scans only columns 0..parentCol (the
// mandatory indentation), so a tab BEYOND it stays legal separation — matching
// the oracle exactly.
// --------------------------------------------------------------------------

test("STRICTNESS PR#29: a tab in block plain scalar continuation indentation throws the tab error, ahead of any colon-fail", () => {
  // No-colon continuation: silently folded to {foo:{a:"bar baz"}} before the fix.
  throwsBecause(() => parse("foo:\n  a: bar\n  \tbaz\n"), /tab character/);
  // …on a LATER fold line too — every fold iteration is checked.
  throwsBecause(() => parse("foo:\n  a: bar\n   baz\n  \tqux\n"), /tab character/);
  // Colon continuation: the tab error must win over "mapping value not allowed"
  // (before the fix this reported the misleading colon message).
  throwsBecause(() => parse("foo:\n  a: 1\n  \tb: 2"), /tab character/);
});

test("STRICTNESS PR#29: a tab BEYOND the mandatory indentation stays legal separation (matches oracle)", () => {
  // Single-line separator tab after the key's `:` — takes the fast path, never
  // enters the fold loop, so it is unaffected.
  deepStrictEqual(parse("foo:\n \tbar"), { foo: "bar" });
  deepStrictEqual(parse("foo:\n \tbar"), oracleParse("foo:\n \tbar"));
  // A continuation-line tab past the parent column is separation, not indentation
  // — folded away here, and the oracle accepts it too.
  deepStrictEqual(parse("- a\n  b\n \tc"), ["a b c"]);
  deepStrictEqual(parse("- a\n  b\n \tc"), oracleParse("- a\n  b\n \tc"));
});
