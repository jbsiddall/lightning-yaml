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
// §4.4/§4.5/§4.9 Merge keys `<<`. IMPLEMENTED, and ON by default — a
// deliberate divergence from both peers, which each require an explicit
// opt-in at the versions this repo targets (js-yaml's `YAML11_SCHEMA`,
// `yaml`'s `{ merge: true }`); see README's "Decisions and deviations" for
// the rationale and test/merge.unit.ts for the full spec (precedence, key
// order, the security cap on merge amplification — this file keeps only a
// differential smoke test plus the flagship four-parser payload).
// `{ merge: false }` restores the pre-merge reading: `<<` becomes an
// ordinary literal string key, neither expanded nor rejected — matching the
// oracle's own (non-merging) default exactly.
// --------------------------------------------------------------------------

test("merge key `<<` merges by default; `{ merge: false }` restores the literal-key reading", () => {
  const y = "base: &b {a: 1, b: 2}\nderived:\n  <<: *b\n  b: 3";
  deepStrictEqual(parse(y), { base: { a: 1, b: 2 }, derived: { a: 1, b: 3 } });
  // The oracle (`yaml`) does NOT merge by default at the version this repo targets — a real
  // divergence (see README's "Decisions and deviations"), not merely an option left off.
  deepStrictEqual(oracleParse(y), { base: { a: 1, b: 2 }, derived: { "<<": { a: 1, b: 2 }, b: 3 } });
  // `{ merge: false }` restores the pre-merge reading, matching the oracle's own default exactly.
  deepStrictEqual(parse(y, { merge: false }), oracleParse(y), "merge: false matches the oracle's own (non-merging) default");

  // A `<<` value that isn't a mapping (or sequence of mappings) is a spec error once merging
  // is on; the pre-merge literal-key reading (today's behaviour under `merge: false`) never throws.
  throwsBecause(() => parse("<<: hello\nn: 1"), /merge key/);
  deepStrictEqual(parse("<<: hello\nn: 1", { merge: false }), { "<<": "hello", n: 1 });
});

test("merge: DarkForge four-parser payload merges the bare `<<` key without crashing", () => {
  // Same adversarial payload as before merge was implemented; only the title's
  // parenthetical is stale now. The payload's FIRST key is a bare, unquoted
  // `<<` — a real merge site today (merge defaults on) — so its source's own
  // key splices up to the top level instead of surviving as a literal
  // `"<<": {...}` entry. The tagged (`!!merge :`) and aliased (`*morge :`)
  // `<<`-lookalikes elsewhere in the payload are deliberately NOT
  // merge-eligible (see applyMerge's doc comment: only a bare, unquoted,
  // untagged, unaliased key merges) and still land as ordinary literal keys.
  const y = `<<: {?"lang": Go, !!merge : {lang: NodeJS}}\ndfl: &morge "<<"\n*morge : {lang: RUBY}\n!!merge : {lang: PYTHON}`;
  const r = parse(y) as Record<string, unknown>;
  ok(r !== null && typeof r === "object", "parses to an object without throwing");
  strictEqual(r['?"lang"'], "Go", "the bare `<<` merge site's own source key spliced up to the top level");
});

// --------------------------------------------------------------------------
// §4.10-adjacent: merge amplification. Unlike aliasing (which SHARES
// structure — one `Map.get`, see the "billion laughs" test above), merging
// COPIES a source's keys at every `<<` site, so a CHAIN of merges-of-merges
// can do far more copying work than any single merge site suggests. js-yaml
// guards this with `maxTotalMergeKeys` (default 10000, matched by
// MAX_TOTAL_MERGE_KEYS in src/core.ts); this locks that the cap actually
// fires, promptly, rather than hanging or exhausting memory.
//
// A chain that each merges the SAME anchor twice (`<<: [*prev, *prev]`, the
// shape a naive "billion laughs for merge" guess reaches for first) turns
// out to grow only LINEARLY here: `hasOwn` dedupes the second copy of every
// key, so each level's OWN key count stays constant and the total considered
// count is just 4 × levels (verified: ~2500 levels needed to cross 10000,
// not a handful). The chain below instead has EACH level merge the ENTIRE
// PREVIOUS (already-accumulated) layer via a SINGLE `<<: *prev` — since
// `hasOwn` can't dedupe against a strictly-growing key set, this genuinely
// compounds: level i's merge considers i-1 keys, so the running total after
// N levels is the triangular number (N-1)×N/2 — quadratic, not linear —
// crossing 10000 by level ~142 off just ~150 lines of source.
// --------------------------------------------------------------------------

test("merge-amplification bomb: a chained nested merge throws promptly, never hangs or OOMs", () => {
  const LEVELS = 150; // (LEVELS-1)*LEVELS/2 = 11175 total merged keys considered, > MAX_TOTAL_MERGE_KEYS (10000)
  let src = "lvl1: &lvl1 {k1: v}\n";
  for (let i = 2; i <= LEVELS; i++) src += `lvl${i}: &lvl${i} {k${i}: v, <<: *lvl${i - 1}}\n`;
  throwsBecause(() => parse(src), /merge keys exceeded/);
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

test("binary: invalid base64 characters (e.g. wide unicode or non-base64 characters) strictly throw YAMLParseError", () => {
  throwsBecause(() => parse("!!binary \"\u0100\u0100\u0100\u0100\""), /invalid base64 character/);
  throwsBecause(() => parse("!!binary \"AAAA-A==\""), /invalid base64 character/);
});
