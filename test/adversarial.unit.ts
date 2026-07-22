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
 *   - empty (`{ : v }`) and collection (`{[1,2]: v}`) keys in a *flow* mapping are
 *     ACCEPTED — both are spec-valid (POSITIVE suite cases SBG9/X38W/FRK4/NKF9); a
 *     collection key is rendered to a flow-style string. (This REVERSES an earlier
 *     build that wrongly rejected them as a "spec error"; see issue #16.)
 *
 * Run: node --import tsx --test test/adversarial.unit.ts
 */

import { test } from "node:test";
import { deepStrictEqual, notDeepStrictEqual, throws, strictEqual, ok } from "node:assert";
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
// §4.12 Complex (non-scalar) and empty mapping keys — the SPEC-derived suite adjudicates.
// A collection used as a key MAY take the explicit `?` indicator (block `? [a,b]`,
// flow `{? [1,2]: v}`), but the IMPLICIT flow forms are valid too: yaml-test-suite
// SBG9 (`{a: [b,c], [d,e]: f}`) and X38W are POSITIVE cases (test.event + out.yaml, no
// `error` file), and FRK4/NKF9 confirm empty flow keys (`{ : v }`). lightning-yaml now
// accepts all of them (issue #16), rendering a collection key to the same flow-style
// string the explicit/block paths use; the `yaml` oracle accepts them too and is right.
// (This REVERSES an earlier build that wrongly rejected the implicit/empty forms as a
// "spec error" and mis-scored SBG9/X38W as negatives — they are unscorable positives.)
// --------------------------------------------------------------------------

test("complex keys: EXPLICIT `?` collection key (block + flow) is accepted per spec", () => {
  deepStrictEqual(parse("? [a, b]\n: v"), { "[ a, b ]": "v" }); // block
  deepStrictEqual(parse("? [a, b]\n: v"), oracleParse("? [a, b]\n: v"));
  deepStrictEqual(parse("? {a: 1}\n: v"), oracleParse("? {a: 1}\n: v"));
  deepStrictEqual(parse("{? [1, 2]: v}"), { "[ 1, 2 ]": "v" }); // explicit flow
  deepStrictEqual(parse("{? [1, 2]: v}"), oracleParse("{? [1, 2]: v}"));
});

test("complex keys: a zero-indented ('compact') block sequence is a valid explicit key (spec §8.2.2; yaml-test-suite 6PBE)", () => {
  // The explicit key and its value share one production (`s-l+block-indented`),
  // so a same-column compact sequence is legal on the KEY side as on the value side.
  deepStrictEqual(parse("?\n- a\n:\n- c\n"), { "[ a ]": ["c"] });
  deepStrictEqual(parse("?\n- a\n- b\n:\n- c\n- d\n"), { "[ a, b ]": ["c", "d"] }); // 6PBE shape
  deepStrictEqual(parse("?\n- a\n"), { "[ a ]": null }); // key only, no ': value'
  deepStrictEqual(parse("?\n- a\n:\n  b: 1\n"), { "[ a ]": { b: 1 } }); // seq key, mapping value
  deepStrictEqual(parse("? x\n: y\n?\n- a\n- b\n: z\n"), { x: "y", "[ a, b ]": "z" }); // 2nd key (loop path)
  for (const s of ["?\n- a\n:\n- c\n", "?\n- a\n- b\n:\n- c\n- d\n", "?\n- a\n", "?\n- a\n:\n  b: 1\n", "? x\n: y\n?\n- a\n- b\n: z\n"]) {
    deepStrictEqual(parse(s), oracleParse(s));
  }
});

test("complex keys: IMPLICIT flow collection key is spec-valid — we accept it (issue #16; suite SBG9/X38W)", () => {
  // REVERSAL (issue #16): an earlier build rejected these as a supposed spec error.
  // SBG9/X38W are POSITIVE yaml-test-suite cases (test.event + out.yaml, no `error`
  // file), so a flow collection used as an implicit key is VALID; the `yaml` oracle was
  // right to accept it and lightning-yaml now does too, rendering the collection to a
  // flow-style key string (identical to the explicit `? [a]` path).
  deepStrictEqual(parse("{[1, 2]: v}"), { "[ 1, 2 ]": "v" });
  deepStrictEqual(parse("{{a: 1}: v}"), { "{ a: 1 }": "v" });
  deepStrictEqual(parse("{a: [b, c], [d, e]: f}"), { a: ["b", "c"], "[ d, e ]": "f" }); // SBG9
  for (const s of ["{[1, 2]: v}", "{{a: 1}: v}", "{a: [b, c], [d, e]: f}"]) deepStrictEqual(parse(s), oracleParse(s));
});

test("complex keys: X38W anchored/aliased flow key parses past the #16 bug; exact outcome tracks duplicate-key policy (issue #16)", () => {
  // X38W is a POSITIVE suite case, so it must NOT throw the #16 "expected a mapping key"
  // error. Its two keys are the SAME node (`*a` aliases `&a`'s sequence), both rendering
  // to the key string "[ a, b ]" — i.e. a DUPLICATE. The exact result therefore depends
  // on our duplicate-key policy, so this test is written to hold under BOTH:
  //   - today (last-wins): the two entries collapse to one; the spelling also diverges
  //     from the oracle, which keeps anchors/aliases textual ("[ a, &b b ]" / "*a");
  //   - after duplicate-key rejection lands (PR #21): the duplicate is a controlled throw.
  const x38w = "{ &a [a, &b b]: *b, *a : [c, *b, d]}";
  try {
    const r = parse(x38w);
    deepStrictEqual(r, { "[ a, b ]": ["c", "b", "d"] });
    notDeepStrictEqual(r, oracleParse(x38w));
  } catch (e) {
    // The one thing that must NEVER happen is the #16 bug — rejecting the key FORM itself.
    ok(e instanceof YAMLParseError && /duplicate mapping key/.test(e.message), `X38W must parse or throw duplicate-key, got: ${e instanceof Error ? e.message : String(e)}`);
  }
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

test("binary: invalid base64 characters (e.g. wide unicode or non-base64 characters) strictly throw YAMLParseError", () => {
  throwsBecause(() => parse("!!binary \"\u0100\u0100\u0100\u0100\""), /invalid base64 character/);
  throwsBecause(() => parse("!!binary \"AAAA-A==\""), /invalid base64 character/);
});
