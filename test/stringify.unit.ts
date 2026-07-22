/**
 * lightning-yaml `stringify()` correctness spec (node:test). Run with:
 *   node --import tsx --test test/stringify.unit.ts
 *   (or: pnpm test:stringify)
 *
 * TEST-FIRST: `stringify` is still a stub in src/index.ts (throws
 * `NotImplementedError`), so EVERY test below is expected to fail today. That is
 * intentional — this file is the concrete spec the next milestone implements
 * against, mirroring how test/parser.unit.ts and the vitest consistency suite
 * were written before `parse` existed. Deliberately kept OUT of `test:unit`/
 * `test` (its own `test:stringify` script) so the core gate (`pnpm typecheck`,
 * `pnpm test:unit`, `pnpm test`) stays green while this stays red.
 *
 * CORRECTNESS MODEL — round-trip, not textual equality. Two YAML writers can
 * legitimately emit different-but-equivalent text for the same value (quoting
 * style, flow vs. block, key order), so we never assert exact output text.
 * Instead, for (almost) every value `v` in the corpus below we assert BOTH:
 *
 *   - roundTripSelf(v):    deepEqual(parse(stringify(v)), v)     — our own
 *     dumper's output must be readable by our own parser.
 *   - roundTripOracle(v):  deepEqual(oracleParse(stringify(v)), v) — our
 *     dumper's output must ALSO be spec-valid YAML that a real, independent,
 *     highly-conformant parser (`yaml`, this repo's oracle — see
 *     bench/oracle.ts) reads back unchanged. This is what proves the output is
 *     genuinely valid YAML and not merely something only our own parser
 *     tolerates.
 *
 * `deepEqual` (below) is a bespoke structural-equality check, not
 * `assert.deepStrictEqual`, because this corpus needs guarantees Node's
 * built-in doesn't cleanly give us in combination:
 *   - object key order never matters (we compare by key membership, not by
 *     `Object.keys()` array order);
 *   - `Uint8Array`s compare by BYTE CONTENT (this is how `!!binary` round-trips);
 *   - `NaN` equals `NaN` (`.inf`/`.nan` core-schema round-trips), and `-0`
 *     equals `0` via ordinary `===` (`Object.is` would wrongly split them —
 *     verified empirically that the oracle actually DOES preserve `-0`'s sign
 *     across its own stringify→parse, so a dedicated stricter check further
 *     below additionally verifies that with `Object.is`, on top of this
 *     lenient default);
 *   - SHARED-REF and CYCLIC graphs are compared structurally, isomorphism-style
 *     (a pair-visited map keyed by the left-hand object), so a self-referential
 *     value can be compared without ever recursing forever.
 *
 * SPEC DECISION — cycles round-trip via anchors/aliases, they do not throw.
 * Verified empirically against the oracle itself (see the probe transcript in
 * the PR description / commit message): `yaml`'s own `stringify()` on a
 * self-referential object does NOT throw — it emits `&a1` at the cycle's root
 * and `*a1` at the back-edge (e.g. `&a1\nself: *a1\n`), and re-parsing that text
 * (even with the oracle's own `parse`, no special options needed for a single
 * back-edge) reconstructs a TRUE cycle: `back.self === back`. Since our own
 * parser already resolves self-referential/cyclic anchors to the very object
 * being built (see "self-referential (cyclic) anchors resolve to the SAME
 * object" in test/parser.unit.ts, M5), the natural, symmetric spec for
 * `stringify` is the same mechanism it already needs for plain shared
 * references (anchor on first sight, alias on reuse) — a cycle is simply a
 * shared reference to a not-yet-finished node. So we assert: (a) `stringify`
 * TERMINATES (does not hang / blow the call stack), (b) the oracle round-trips
 * the value with reference identity restored, and (c) so does our own parser.
 * We do NOT accept "throws on cycles" as an alternative here — the oracle
 * itself doesn't, and throwing would be a strictly weaker, needlessly-lossy
 * choice this codebase has no other precedent for (anchors/aliases are already
 * a first-class, implemented feature of `parse`).
 */

import { test } from "node:test";
import { ok, strictEqual, deepStrictEqual, throws } from "node:assert";
import { parse, stringify } from "../src/index.ts";
import { oracleParse } from "../bench/oracle.ts";
import { makeRng, type Rng } from "../bench/util/prng.ts";

// ---------------------------------------------------------------------------
// deepEqual — see the file header for why this isn't assert.deepStrictEqual.
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown, aSeen: Map<object, unknown> = new Map(), bSeen: Map<object, unknown> = new Map()): boolean {
  if (a === b) return true; // primitives, reference identity, and `-0 === 0`
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  // Cycle/shared-ref guard: once `a` has been paired with some `b`, a later
  // encounter of that same `a` must map to that SAME `b` — checked, not
  // re-recursed — which is what keeps a self-referential/cyclic structure
  // from looping forever while still verifying the two graphs are isomorphic.
  const pairedB = aSeen.get(a);
  if (pairedB !== undefined || aSeen.has(a)) return pairedB === b;
  if (bSeen.has(b)) return false; // `b` already claimed by a different `a`
  aSeen.set(a, b);
  bSeen.set(b, a);

  const aBytes = a instanceof Uint8Array;
  const bBytes = b instanceof Uint8Array;
  if (aBytes || bBytes) {
    if (!aBytes || !bBytes) return false;
    const bufA = a as Uint8Array;
    const bufB = b as Uint8Array;
    if (bufA.length !== bufB.length) return false;
    for (let i = 0; i < bufA.length; i++) if (bufA[i] !== bufB[i]) return false;
    return true;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (!deepEqual(arrA[i], arrB[i], aSeen, bSeen)) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!deepEqual(objA[key], objB[key], aSeen, bSeen)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The two round-trip predicates the task specifies, plus a thin assertion
// wrapper used everywhere below.
// ---------------------------------------------------------------------------

/** Our own dumper's output must be readable by our own parser. */
function roundTripSelf(value: unknown): boolean {
  return deepEqual(parse(stringify(value)), value);
}

/** Our own dumper's output must ALSO be spec-valid YAML per the oracle. */
function roundTripOracle(value: unknown): boolean {
  return deepEqual(oracleParse(stringify(value)), value);
}

function assertRoundTrips(value: unknown, label: string): void {
  ok(roundTripSelf(value), `roundTripSelf failed · ${label}`);
  ok(roundTripOracle(value), `roundTripOracle failed · ${label}`);
}

/** A scalar tested standalone, as a map value, and as a sequence item. */
function testScalarRoundTrips(label: string, value: unknown): void {
  test(`scalar round-trip · ${label} (bare)`, () => {
    assertRoundTrips(value, `${label} (bare)`);
  });
  test(`scalar round-trip · ${label} (map value)`, () => {
    assertRoundTrips({ k: value }, `${label} (map value)`);
  });
  test(`scalar round-trip · ${label} (seq item)`, () => {
    assertRoundTrips([value], `${label} (seq item)`);
  });
}

/**
 * The #1 trap: a string that LOOKS like a null/bool/number/etc. under the 1.2
 * core schema must be quoted so it round-trips as the STRING, never
 * reinterpreted as the scalar it resembles. Beyond the plain round-trip, this
 * additionally asserts the decoded type is exactly `"string"`.
 */
function testTrapString(label: string, str: string): void {
  test(`trap string stays a string · ${label}`, () => {
    assertRoundTrips(str, `${label} (bare)`);
    assertRoundTrips({ k: str }, `${label} (map value)`);
    assertRoundTrips([str], `${label} (seq item)`);
    strictEqual(typeof parse(stringify(str)), "string", `${label}: must decode as a string via ours, not a re-typed scalar`);
    strictEqual(typeof oracleParse(stringify(str)), "string", `${label}: must decode as a string via the oracle, not a re-typed scalar`);
  });
}

// ---------------------------------------------------------------------------
// 1. Seeded random corpus — adapted from test/parser.unit.ts's `makeValue`
// (duplicated locally since that generator isn't exported): a mix of small and
// numeric-looking-but-actually-string values, words, booleans, null, unicode
// strings, and nested objects/arrays, generated deterministically.
// ---------------------------------------------------------------------------

function makeValue(rng: Rng, d: number): unknown {
  if (d <= 0) {
    switch (rng.int(0, 7)) {
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
        return String(rng.int(0, 999)); // numeric-looking string — must round-trip as a STRING
      case 6:
        return rng.chars(rng.int(0, 40)); // occasionally includes unicode
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

test("seeded random corpus (400 cases): stringify -> parse round-trips (self + oracle)", () => {
  const rng = makeRng(20260713);
  const CASES = 400;
  for (let i = 0; i < CASES; i++) {
    const value = makeValue(rng, rng.int(1, 5));
    const text = stringify(value); // throws NotImplementedError today — see file header
    ok(deepEqual(parse(text), value), `roundTripSelf failed · seeded case #${i}\n${JSON.stringify(value)}\n--- text ---\n${text}`);
    ok(deepEqual(oracleParse(text), value), `roundTripOracle failed · seeded case #${i}\n${JSON.stringify(value)}\n--- text ---\n${text}`);
  }
});

// ---------------------------------------------------------------------------
// 2a. Scalar edge cases — null/bool/numbers, floats, and the special float
// words (.inf/-.inf/.nan). Each is tested bare, as a map value, and as a
// sequence item via `testScalarRoundTrips`.
// ---------------------------------------------------------------------------

const basicScalars: Array<[string, unknown]> = [
  ["null", null],
  ["true", true],
  ["false", false],
  ["0", 0],
  ["-0", -0],
  ["1", 1],
  ["-1", -1],
  ["big int: MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
  ["big int: MAX_SAFE_INTEGER + 2 (unsafe)", 9007199254740993],
  ["big int: beyond 2^53 (~1.23e19)", 12345678901234567890],
  ["big int: negative, beyond 2^53", -12345678901234567890],
  ["float 1.5", 1.5],
  ["float -0.0 (same double as -0)", -0.0],
  ["float 1e21", 1e21],
  ["float 1e-7", 1e-7],
  ["float pi-ish", 3.14159],
  ["float -pi-ish", -3.14159],
  ["float MIN_VALUE (5e-324)", Number.MIN_VALUE],
  ["float MAX_VALUE", Number.MAX_VALUE],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["NaN", NaN],
];

for (const [label, value] of basicScalars) testScalarRoundTrips(label, value);

test("scalar: -0 keeps its sign across the oracle (Object.is, stricter than the general deepEqual)", () => {
  // The general `deepEqual`/round-trip helpers above deliberately treat -0 and
  // 0 as equal (via `===`) so unrelated corpus entries don't spuriously fail on
  // sign-of-zero. But we verified empirically that the oracle's own
  // stringify->parse round-trip DOES preserve the sign of zero, so hold our own
  // implementation to the same, stricter bar here.
  const text = stringify(-0);
  ok(Object.is(oracleParse(text), -0), `expected the oracle to read back -0 (with its sign), got ${String(oracleParse(text))} from ${JSON.stringify(text)}`);
});

// ---------------------------------------------------------------------------
// 2b. THE #1 TRAP — strings that must be QUOTED so they don't round-trip as a
// different type under the 1.2 core schema.
// ---------------------------------------------------------------------------

const trapStrings: Array<[string, string]> = [
  ['the string "true"', "true"],
  ['the string "false"', "false"],
  ['the string "null"', "null"],
  ['the string "~"', "~"],
  ['the string "123"', "123"],
  ['the string "1.5"', "1.5"],
  ['the string "0x10"', "0x10"],
  ['the string "0o7"', "0o7"],
  ['the string ".inf"', ".inf"],
  ['the string ".nan"', ".nan"],
  ["empty string", ""],
  ['the string "yes" (1.1-ism, stays a string under 1.2 core)', "yes"],
  ['the string "no" (1.1-ism, stays a string under 1.2 core)', "no"],
  ['the string "on" (1.1-ism, stays a string under 1.2 core)', "on"],
  ['the string "off" (1.1-ism, stays a string under 1.2 core)', "off"],
  ["a string of only spaces", "   "],
  ['the string "-0"', "-0"],
  ['the string "..." (document-end marker, issue #19)', "..."],
  ['the string "---" (document-start marker, issue #19)', "---"],
];

for (const [label, value] of trapStrings) testTrapString(label, value);

// ---------------------------------------------------------------------------
// 2b-i. Issue #19 regression — a root scalar that is EXACTLY the document-end
// (`...`) or document-start (`---`) marker must be quoted, not just any string
// that merely starts/contains those characters. `testTrapString` above (via
// the `trapStrings` entries) already locks the round-trip; this locks the
// literal emitted text so a future refactor can't silently widen or narrow
// `isPlainScalarSafe`'s new guard.
// ---------------------------------------------------------------------------

test('document markers: "..." and "---" as root scalars are quoted, not bare (issue #19)', () => {
  strictEqual(stringify("..."), "'...'\n", '"..." must be quoted so it does not read back as the document-end marker');
  strictEqual(stringify("---"), "'---'\n", '"---" must stay quoted (already correct pre-fix via the leading "-" indicator rule)');
});

test("document markers: near-miss strings stay bare/unquoted (must NOT be caught by the new guard, issue #19)", () => {
  const bareUnchanged = ["a.b", "...x", "x...", "..", "...."];
  for (const s of bareUnchanged) {
    strictEqual(stringify(s), s + "\n", `${JSON.stringify(s)} must stay emitted bare, unaffected by the issue #19 fix`);
  }
});

test('document markers: "1.5" stays quoted for its pre-existing numeric-looking reason, unaffected by the new guard (issue #19)', () => {
  strictEqual(stringify("1.5"), "'1.5'\n");
});

// ---------------------------------------------------------------------------
// 2c. Strings needing quoting/escaping for structural reasons (leading
// indicators, embedded special characters, control characters, multi-line
// content, unicode, and very long strings).
// ---------------------------------------------------------------------------

const quoteNeededStrings: Array<[string, string]> = [
  ["leading space", " x"],
  ["trailing space", "x "],
  ["leading '-'", "-x"],
  ["leading '?'", "?x"],
  ["leading ':'", ":x"],
  ["leading '#'", "#x"],
  ["leading '&'", "&x"],
  ["leading '*'", "*x"],
  ["leading '!'", "!x"],
  ["leading '|'", "|x"],
  ["leading '>'", ">x"],
  ["leading '%'", "%x"],
  ["leading '@'", "@x"],
  ["leading '`'", "`x"],
  ["leading '['", "[x"],
  ["leading ']'", "]x"],
  ["leading '{'", "{x"],
  ["leading '}'", "}x"],
  ["leading ','", ",x"],
  ['leading \'"\'', '"x'],
  ["leading \"'\"", "'x"],
  ["interior ' #' (a comment-looking span)", "a # b"],
  ["colon followed by space", "a: b"],
  ["contains both quote kinds", "a'b\"c"],
  ["backslash", "a\\b"],
  ["tab", "a\tb"],
  ["single embedded newline", "a\nb"],
  ["multiple embedded newlines", "a\nb\nc\nd"],
  ["leading newline", "\na"],
  ["trailing newline", "a\n"],
  ["only a newline", "\n"],
  ["leading AND trailing newlines", "\na\n"],
  ["unicode text", "héllo wörld — 日本語"],
  ["emoji", "party \u{1f389} rocket \u{1f680}"],
  ["NUL byte", "a" + String.fromCharCode(0) + "b"],
  ["other C0 control chars", "a" + String.fromCharCode(1, 2, 31) + "b"],
  ["very long string (~18,000 chars)", "lightning".repeat(2000)],
];

for (const [label, value] of quoteNeededStrings) testScalarRoundTrips(label, value);

// ---------------------------------------------------------------------------
// 3. Collections — empty, nested/mixed, quoting-needed map keys, and deep
// nesting (kept well under the parser's MAX_DEPTH = 1000 guard).
// ---------------------------------------------------------------------------

test("collection: empty map {}", () => {
  assertRoundTrips({}, "empty map");
});

test("collection: empty seq []", () => {
  assertRoundTrips([], "empty seq");
});

test("collection: nested/mixed maps and sequences", () => {
  const value = {
    list: [1, 2, { nested: true }, ["a", "b"]],
    map: { x: { y: { z: [1, 2, 3] } } },
    mixed: [{ a: 1 }, [1, [2, [3]]], null, "text"],
    empties: { emptyMap: {}, emptySeq: [] },
  };
  assertRoundTrips(value, "nested/mixed collections");
});

test("collection: map keys needing quoting", () => {
  const value: Record<string, unknown> = {};
  value[""] = "empty key";
  value["123"] = "numeric key";
  value["true"] = "bool-word key";
  value["a b"] = "space key";
  value["a:b"] = "colon key";
  value["-x"] = "dash-leading key";
  value["a\nb"] = "newline key";
  assertRoundTrips(value, "map with quoting-needed keys");
  // `object key order is irrelevant` is exercised implicitly by deepEqual; also
  // spot-check the key set survived intact (not dropped/merged).
  const text = stringify(value);
  const ours = parse(text) as Record<string, unknown>;
  deepStrictEqual(new Set(Object.keys(ours)), new Set(Object.keys(value)));
});

test("collection: deeply nested object chain (depth 300, under the 1000 recursion guard)", () => {
  const DEPTH = 300;
  let value: unknown = { leaf: true };
  for (let i = 0; i < DEPTH; i++) value = { child: value };
  assertRoundTrips(value, `nested object chain depth ${DEPTH}`);
});

test("collection: deeply nested array chain (depth 300, under the 1000 recursion guard)", () => {
  const DEPTH = 300;
  let value: unknown = ["leaf"];
  for (let i = 0; i < DEPTH; i++) value = [value];
  assertRoundTrips(value, `nested array chain depth ${DEPTH}`);
});

test("collection: empty container at the MAX_DEPTH boundary throws in stringify", () => {
  // Regression guard. A chain of MAX_DEPTH nested maps/seqs ending in an empty
  // container sits one level too deep: `dumpScanRefs` depth-counts every container
  // (empty ones included) and throws before the write, exactly as our own parser
  // rejects the same document. One level shallower must still emit.
  const MAX_DEPTH = 1000; // mirrors src/index.ts's recursion guard
  let objChain: unknown = {};
  for (let i = 0; i < MAX_DEPTH; i++) objChain = { c: objChain };
  throws(() => stringify(objChain), /maximum nesting depth exceeded/, "empty {} terminal at MAX_DEPTH");
  let arrChain: unknown = [];
  for (let i = 0; i < MAX_DEPTH; i++) arrChain = [arrChain];
  throws(() => stringify(arrChain), /maximum nesting depth exceeded/, "empty [] terminal at MAX_DEPTH");
  // No over-correction: one level shallower stays emittable.
  let under: unknown = {};
  for (let i = 0; i < MAX_DEPTH - 1; i++) under = { c: under };
  ok(typeof stringify(under) === "string");
});

// ---------------------------------------------------------------------------
// 4. `Uint8Array` (`!!binary`) — our own parser already decodes `!!binary` to a
// plain Uint8Array (M5), so both roundTripSelf and roundTripOracle apply.
// ---------------------------------------------------------------------------

function makeBytes(n: number, rng: Rng): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.int(0, 255);
  return out;
}

test("Uint8Array: empty", () => {
  assertRoundTrips(new Uint8Array(0), "empty Uint8Array");
});

test("Uint8Array: small, fixed bytes incl. 0x00 and 0xff boundaries", () => {
  assertRoundTrips(new Uint8Array([0, 1, 2, 253, 254, 255]), "small Uint8Array with boundary bytes");
});

test("Uint8Array: long random bytes (4096)", () => {
  const rng = makeRng(20260713);
  const bytes = makeBytes(4096, rng);
  assertRoundTrips(bytes, "long Uint8Array (4096 bytes)");
});

test("Uint8Array: nested inside maps/sequences, alongside other scalars", () => {
  const rng = makeRng(777);
  const value = {
    blob: makeBytes(64, rng),
    list: [makeBytes(8, rng), makeBytes(0, rng)],
    note: "binary payload test",
  };
  assertRoundTrips(value, "Uint8Array nested in collections");
});

// ---------------------------------------------------------------------------
// 5. Shared references — the SAME object/array reachable from >= 2 places must
// round-trip deep-equal AND (checked directly, since deepEqual alone can't
// distinguish a shared reference from an accidental deep-equal copy) must
// resolve to the SAME reference after our own stringify -> parse round-trip.
// A naive stringifier that just deep-copies would still pass the deepEqual
// checks, so the strictEqual identity checks below are the real assertion.
// ---------------------------------------------------------------------------

test("shared reference: same object referenced twice from a map", () => {
  const shared = { tag: "config", version: 1 };
  const value = { a: shared, b: shared };
  assertRoundTrips(value, "shared object from two map fields");

  const text = stringify(value);
  const ours = parse(text) as { a: object; b: object };
  strictEqual(ours.a, ours.b, "stringify must anchor a shared object, not deep-copy it");
});

test("shared reference: same array referenced from two sequence slots", () => {
  const shared = [1, 2, 3];
  const value = [shared, shared, "x"];
  assertRoundTrips(value, "shared array from two seq slots");

  const text = stringify(value);
  const ours = parse(text) as unknown[];
  strictEqual(ours[0], ours[1], "stringify must anchor a shared array, not deep-copy it");
});

test("nested sharing: a shared leaf reused inside different branches/depths", () => {
  const leaf = { id: "leaf", value: 42 };
  const value = {
    branchA: { deep: { leaf } },
    branchB: [{ leaf }, { other: leaf }],
  };
  assertRoundTrips(value, "shared leaf reused at different nesting depths/positions");

  const text = stringify(value);
  const ours = parse(text) as { branchA: { deep: { leaf: object } }; branchB: [{ leaf: object }, { other: object }] };
  strictEqual(ours.branchA.deep.leaf, ours.branchB[0].leaf, "leaf shared across branchA/branchB[0]");
  strictEqual(ours.branchA.deep.leaf, ours.branchB[1].other, "leaf shared across branchA/branchB[1]");
});

test("heavily shared: one object referenced from thousands of places round-trips and stays bounded (size + time)", () => {
  // Naive duplication of a ~70-char object 3000 times would be ~210,000 chars;
  // anchor-based emission (one definition + N short aliases) should be roughly
  // linear and much smaller (empirically ~18KB via the oracle's own dumper on
  // this exact shape — see the commit message for the probe).
  const shared = { tag: "config", region: "us-west", tier: 3, note: "shared config object" };
  const N = 3000;
  const value: unknown[] = new Array(N).fill(shared);

  const start = Date.now();
  const text = stringify(value);
  const elapsedMs = Date.now() - start;

  ok(text.length < 60_000, `expected anchored output to stay well under naive-duplication size; got ${text.length} chars`);
  ok(elapsedMs < 3000, `expected stringify to be fast for a heavily-shared value; took ${elapsedMs}ms`);

  const ours = parse(text) as unknown[];
  ok(deepEqual(ours, value), "roundTripSelf failed for heavily-shared value");
  for (let i = 1; i < N; i++) strictEqual(ours[i], ours[0], `slot ${i} must share the same reference as slot 0`);

  const oracleValue = oracleParse(text);
  ok(deepEqual(oracleValue, value), "roundTripOracle failed for heavily-shared value");
});

test("nested sharing (diamond DAG): repeated re-sharing across levels stays bounded, not exponential", () => {
  // Each level re-shares the SAME previous level as both `left` and `right`.
  // A naive stringifier without cycle/sharing detection would recursively
  // re-expand every branch, blowing up to ~2^DEPTH leaf mentions; a correct,
  // anchor-based one stays near-linear in DEPTH (empirically ~1.5KB via the
  // oracle's own dumper at DEPTH=18 — see the commit message for the probe).
  const DEPTH = 18;
  let level: unknown = { id: 0, tag: "leaf" };
  for (let i = 1; i <= DEPTH; i++) {
    level = { id: i, left: level, right: level }; // left/right are the SAME reference
  }

  const start = Date.now();
  const text = stringify(level);
  const elapsedMs = Date.now() - start;

  ok(text.length < 20_000, `expected near-linear-in-depth output (naive duplication would be ~2^${DEPTH}); got ${text.length} chars`);
  ok(elapsedMs < 5000, `expected stringify to stay fast on a shared DAG, not exponential; took ${elapsedMs}ms`);

  const ours = parse(text) as { left: unknown; right: unknown };
  ok(deepEqual(ours, level), "roundTripSelf failed for diamond DAG");
  strictEqual(ours.left, ours.right, "left/right must resolve to the same shared reference");

  const oracleValue = oracleParse(text);
  ok(deepEqual(oracleValue, level), "roundTripOracle failed for diamond DAG");
});

// ---------------------------------------------------------------------------
// 6. Cycles — see the file header for the chosen spec (round-trip via anchors/
// aliases, matching the oracle's own behavior) and why it was chosen.
// ---------------------------------------------------------------------------

test("cycle: a.self = a terminates and round-trips via anchors (identity preserved)", () => {
  const obj: Record<string, unknown> = {};
  obj.self = obj;

  const text = stringify(obj); // must terminate — not hang, not blow the call stack

  const oracleValue = oracleParse(text) as { self: unknown };
  ok(deepEqual(oracleValue, obj), "oracle round-trip must be structurally equal (cycle-safe deepEqual)");
  strictEqual(oracleValue.self, oracleValue, "oracle must reconstruct the SAME cyclic identity, not an infinite unrolled copy");

  const oursValue = parse(text) as { self: unknown };
  ok(deepEqual(oursValue, obj), "our own round-trip must be structurally equal");
  strictEqual(oursValue.self, oursValue, "our own parser must reconstruct the SAME cyclic identity");
});

test("cycle: a[0] = a (cyclic array) terminates and round-trips via anchors", () => {
  const arr: unknown[] = [];
  arr.push(arr);

  const text = stringify(arr); // must terminate

  const oracleValue = oracleParse(text) as unknown[];
  strictEqual(oracleValue[0], oracleValue, "oracle must reconstruct the SAME cyclic identity");

  const oursValue = parse(text) as unknown[];
  strictEqual(oursValue[0], oursValue, "our own parser must reconstruct the SAME cyclic identity");
});

test("cycle: mutual (two-node) cycle a.next = b, b.next = a", () => {
  const a: Record<string, unknown> = { name: "a" };
  const b: Record<string, unknown> = { name: "b" };
  a.next = b;
  b.next = a;

  const text = stringify(a); // must terminate

  const oracleA = oracleParse(text) as { name: string; next: { name: string; next: unknown } };
  strictEqual(oracleA.name, "a");
  strictEqual(oracleA.next.name, "b");
  strictEqual(oracleA.next.next, oracleA, "oracle must reconstruct the two-node cycle");

  const oursA = parse(text) as { name: string; next: { name: string; next: unknown } };
  strictEqual(oursA.next.next, oursA, "our own parser must reconstruct the two-node cycle");
});

test("cycle: a cyclic field nested inside an otherwise-ordinary structure", () => {
  const loop: Record<string, unknown> = { kind: "loop" };
  loop.self = loop;
  const value = { data: [1, 2, 3], note: "has a cyclic field", loop };

  const text = stringify(value); // must terminate

  const oracleValue = oracleParse(text) as { data: number[]; note: string; loop: { self: unknown } };
  deepStrictEqual(oracleValue.data, [1, 2, 3]);
  strictEqual(oracleValue.note, "has a cyclic field");
  strictEqual(oracleValue.loop.self, oracleValue.loop, "the nested cyclic field must still resolve to itself");
});

// ---------------------------------------------------------------------------
// 7. Special keys — __proto__/constructor/prototype as map keys must round-trip
// without ever polluting Object.prototype.
// ---------------------------------------------------------------------------

test("special keys: __proto__ as an own data property (not prototype pollution) round-trips safely", () => {
  // Built via JSON.parse (like the parser's own prototype-pollution test in
  // test/parser.unit.ts) so "__proto__" is a genuine OWN enumerable property —
  // never the object-LITERAL special case (`{ __proto__: x }`), which would
  // instead set the object's [[Prototype]] rather than creating a property.
  const value = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}') as Record<string, unknown>;
  ok(Object.prototype.hasOwnProperty.call(value, "__proto__"), "test setup sanity: __proto__ must be an own property");

  assertRoundTrips(value, "__proto__ as an own map key");

  const text = stringify(value);
  const ours = parse(text) as Record<string, unknown>;
  ok(Object.prototype.hasOwnProperty.call(ours, "__proto__"), "stringify+parse must keep __proto__ as an own property");
  const probe = {} as Record<string, unknown>;
  strictEqual(probe.polluted, undefined, "must not pollute Object.prototype");
});

test("special keys: constructor / prototype as ordinary map keys", () => {
  const value = { constructor: 1, prototype: 2 };
  assertRoundTrips(value, "constructor/prototype keys");
});
