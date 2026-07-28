/**
 * Merge-key (`<<`) correctness spec (node:test). Run with:
 *   node --import tsx --test test/merge.unit.ts
 * or via:
 *   pnpm test:unit   (runs this file alongside test/parser.unit.ts,
 *                      test/adversarial.unit.ts, and test/compat.unit.ts)
 *
 * Named `*.unit.ts` (not `*.test.ts`) so vitest's glob (test/**\/*.test.ts)
 * ignores it, matching test/parser.unit.ts's and test/compat.unit.ts's convention.
 *
 * This file is the SPEC for `<<` merge support: it was written before the parser
 * could merge anything, and the implementation was written to satisfy it. Treat a
 * failure here as a parser bug, not a test to adjust.
 *
 * SOURCE-OF-TRUTH EXCEPTION — read this before editing anything below. CLAUDE.md's
 * precedence rule normally ranks the YAML 1.2.2 spec above `js-yaml`/`yaml`, which
 * are merely differential aids, never the definition of correct. Merge keys are a
 * deliberate, explicit exception to that rule: `<<` is a YAML 1.1 type
 * (`tag:yaml.org,2002:merge`, from the 1.1 type repository —
 * https://yaml.org/type/merge.html), and YAML 1.2.2's core schema does not define
 * it at all — so neither the spec nor the yaml-test-suite (which doesn't exercise
 * `<<`) has an opinion here. js-yaml and `yaml` both implement it and real-world
 * YAML depends on it heavily, so for THIS ONE FEATURE the peer libraries ARE the
 * de-facto oracle, not just a candidate signal. M1 below is that differential
 * check; M2 is the one invariant that survives even if a peer's own behavior
 * later changes.
 *
 * A GOTCHA uncovered while building the above: NEITHER peer merges by default.
 * js-yaml's only merge-tag-bearing schema is `YAML11_SCHEMA` — it has no narrower
 * "just enable merge" flag, so opting in also switches on the rest of YAML 1.1
 * scalar resolution (`y`/`n`/`yes`/`no`/`on`/`off` become booleans, etc.) as a side
 * effect. `yaml`'s `{ merge: true }` is narrow and doesn't touch scalar resolution
 * at all. So every fixture below avoids YAML-1.1-ambiguous plain scalars — the
 * same discipline test/compat.unit.ts's DUMP_VALUE already documents — to keep
 * every comparison isolated to merge semantics, not an incidental schema
 * disagreement between the two peers' opt-in mechanisms.
 */

import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import * as jsyamlReal from "js-yaml";
import * as yamlReal from "yaml";
import { parse, stringify, YAMLParseError } from "../src/index.ts";

/**
 * Real js-yaml and real yaml both gate merge support behind an explicit opt-in —
 * see the file header for why each needs a different option, and why fixtures
 * avoid YAML-1.1-ambiguous scalars so that opt-in doesn't itself cause a
 * disagreement unrelated to merging.
 */
function jsyamlWithMerge(text: string): unknown {
  return jsyamlReal.load(text, { schema: jsyamlReal.YAML11_SCHEMA });
}
function yamlWithMerge(text: string): unknown {
  return yamlReal.parse(text, { merge: true });
}

// --------------------------------------------------------------------------
// M1 — differential against BOTH peers, the primary oracle for this feature
// (see the file header's source-of-truth exception). A broad table of
// representative merge documents in block form; M8 repeats the applicable
// ones in flow form.
// --------------------------------------------------------------------------

const differentialDocs = [
  ["single merge (config inherits shared defaults)", "defaults: &d\n  adapter: postgres\n  host: localhost\ndevelopment:\n  <<: *d\n  database: dev_db\n"],
  ["sequence merge, no key overlap", "a: &a\n  adapter: postgres\nb: &b\n  host: localhost\nresult:\n  <<: [*a, *b]\n  database: dev_db\n"],
  ["sequence merge, overlapping key (earlier source wins)", "a: &a\n  p: 1\nb: &b\n  p: 2\nresult:\n  <<: [*a, *b]\n"],
  ["override: own key BEFORE the << line beats the merged value", "a: &a\n  p: 1\n  q: 2\nresult:\n  p: 99\n  <<: *a\n"],
  ["override: own key AFTER the << line beats the merged value", "a: &a\n  p: 1\n  q: 2\nresult:\n  <<: *a\n  p: 99\n"],
  ["shallow: a merged nested map is replaced whole by an own key of the same name", "a: &a\n  nested:\n    p: 1\n    q: 2\nresult:\n  <<: *a\n  nested:\n    p: 99\n"],
] as const;

for (const [label, text] of differentialDocs) {
  test(`differential vs both peers · ${label}`, () => {
    deepStrictEqual(parse(text), jsyamlWithMerge(text));
    deepStrictEqual(parse(text), yamlWithMerge(text));
  });
}

// --------------------------------------------------------------------------
// M2 — expansion equivalence: parse(merge form) deep-equals parse(hand-expanded
// form). Deliberately PEER-INDEPENDENT (only our own parse(), called twice) —
// this is the invariant that survives even if a peer's behavior changes later.
// --------------------------------------------------------------------------

const expansionPairs = [
  ["single merge", "a: &a\n  p: 1\n  q: 2\nresult:\n  <<: *a\n  r: 3\n", "a: &a\n  p: 1\n  q: 2\nresult:\n  p: 1\n  q: 2\n  r: 3\n"],
  [
    "sequence merge",
    "a: &a\n  p: 1\nb: &b\n  q: 2\nresult:\n  <<: [*a, *b]\n  r: 3\n",
    "a: &a\n  p: 1\nb: &b\n  q: 2\nresult:\n  p: 1\n  q: 2\n  r: 3\n",
  ],
  ["override", "a: &a\n  p: 1\n  q: 2\nresult:\n  <<: *a\n  p: 99\n", "a: &a\n  p: 1\n  q: 2\nresult:\n  p: 99\n  q: 2\n"],
  [
    "nested-but-shallow",
    "a: &a\n  nested:\n    p: 1\n    q: 2\nresult:\n  <<: *a\n  nested:\n    p: 99\n",
    "a: &a\n  nested:\n    p: 1\n    q: 2\nresult:\n  nested:\n    p: 99\n",
  ],
] as const;

for (const [label, merged, expanded] of expansionPairs) {
  test(`expansion equivalence (peer-independent) · ${label}`, () => {
    deepStrictEqual(parse(merged), parse(expanded));
  });
}

// --------------------------------------------------------------------------
// M3 — precedence, asserted against exact hardcoded expected values (a third,
// independent way of pinning down "correct" alongside M1's peer diff and M2's
// hand-expansion — this feature is fiddly enough to earn the triangulation).
// --------------------------------------------------------------------------

test("precedence: explicit key wins over merged key, written BEFORE the << line", () => {
  const t = "a: &a\n  p: 1\n  q: 2\nresult:\n  p: 99\n  <<: *a\n";
  deepStrictEqual(parse(t), { a: { p: 1, q: 2 }, result: { p: 99, q: 2 } });
});

test("precedence: explicit key wins over merged key, written AFTER the << line", () => {
  const t = "a: &a\n  p: 1\n  q: 2\nresult:\n  <<: *a\n  p: 99\n";
  deepStrictEqual(parse(t), { a: { p: 1, q: 2 }, result: { p: 99, q: 2 } });
});

test("precedence: in a sequence merge, the EARLIER source wins on overlapping keys", () => {
  const t = "a: &a\n  p: 1\nb: &b\n  p: 2\n  q: 3\nresult:\n  <<: [*a, *b]\n";
  deepStrictEqual(parse(t), { a: { p: 1 }, b: { p: 2, q: 3 }, result: { p: 1, q: 3 } });
});

test("precedence: a merged key absent from the map's own keys is inherited", () => {
  const t = "a: &a\n  p: 1\n  q: 2\nresult:\n  <<: *a\n  r: 3\n";
  deepStrictEqual(parse(t), { a: { p: 1, q: 2 }, result: { p: 1, q: 2, r: 3 } });
});

test("precedence: shallow merge — a nested map is taken WHOLE, never deep-merged into an existing nested map", () => {
  const t = "a: &a\n  nested:\n    p: 1\n    q: 2\nresult:\n  <<: *a\n  nested:\n    p: 99\n";
  // If merging were deep, result.nested would be {p: 99, q: 2}. It is not — the
  // map's OWN "nested" key wins in full (the precedence rule above is absolute,
  // not per-field), so `q` from the merged source's nested map never appears.
  deepStrictEqual(parse(t), { a: { nested: { p: 1, q: 2 } }, result: { nested: { p: 99 } } });
});

// --------------------------------------------------------------------------
// M4 — key order (resolved empirically, not guessed). Both peers EXPAND merged
// keys IN PLACE at the position where `<<` appears — not appended at the end —
// so merged keys can land mid-object. `<<` itself never appears in the key list.
// Verified live: node --import tsx against js-yaml@5 (YAML11_SCHEMA) and yaml@2
// (merge: true); both agree exactly on every case below. Order is observable
// through Object.keys and through stringify output, so it's worth pinning down
// rather than leaving to "however the implementation happens to fall out."
// --------------------------------------------------------------------------

test("key order: single merge splices merged keys in place between the surrounding own keys", () => {
  const text = "d: &d\n  c: 3\n  e: 4\na: 1\n<<: *d\nb: 2\n";
  const expected = ["d", "a", "c", "e", "b"];
  deepStrictEqual(Object.keys(parse(text) as object), expected);
  deepStrictEqual(Object.keys(parse(text) as object), Object.keys(jsyamlWithMerge(text) as object));
  deepStrictEqual(Object.keys(parse(text) as object), Object.keys(yamlWithMerge(text) as object));
});

test("key order: sequence merge splices ALL sources' keys in place, in sequence order", () => {
  const text = "d: &d\n  c: 3\ne2: &e2\n  f: 5\na: 1\n<<: [*d, *e2]\nb: 2\n";
  const expected = ["d", "e2", "a", "c", "f", "b"];
  deepStrictEqual(Object.keys(parse(text) as object), expected);
  deepStrictEqual(Object.keys(parse(text) as object), Object.keys(jsyamlWithMerge(text) as object));
  deepStrictEqual(Object.keys(parse(text) as object), Object.keys(yamlWithMerge(text) as object));
});

test("key order: flow form splices merged keys in place too (same rule as block)", () => {
  const text = "d: &d {c: 3, e: 4}\nresult: {a: 1, <<: *d, b: 2}\n";
  const expected = ["a", "c", "e", "b"];
  deepStrictEqual(Object.keys((parse(text) as { result: object }).result), expected);
  deepStrictEqual(Object.keys((jsyamlWithMerge(text) as { result: object }).result), expected);
  deepStrictEqual(Object.keys((yamlWithMerge(text) as { result: object }).result), expected);
});

// --------------------------------------------------------------------------
// M5 — errors: a << value that is not a mapping (or a sequence of mappings) is
// a hard error. Verified live against both peers for every case below — no
// leniency divergence found (both always throw), so there's no "peer is
// lenient where we throw" case to record for this feature.
// --------------------------------------------------------------------------

const mergeErrorCases = [
  ["<<: 5 (scalar number)", "result:\n  <<: 5\n"],
  ['<<: "str" (scalar string)', 'result:\n  <<: "str"\n'],
  ["<<: [1, 2] (sequence of non-maps)", "result:\n  <<: [1, 2]\n"],
  ["<<: [*a, 5] (sequence mixing a map alias with a non-map)", "a: &a\n  p: 1\nresult:\n  <<: [*a, 5]\n"],
] as const;

for (const [label, text] of mergeErrorCases) {
  test(`errors: an invalid merge source throws YAMLParseError · ${label}`, () => {
    throws(() => parse(text), (err: unknown) => err instanceof YAMLParseError);
    throws(() => jsyamlWithMerge(text)); // both peers reject it too — confirmed, not assumed
    throws(() => yamlWithMerge(text));
  });
}

test("errors: << aliasing an undefined anchor already throws TODAY (regression guard, not new behavior)", () => {
  // Not a merge-specific mechanism — any alias to an undefined anchor already
  // throws (test/parser.unit.ts's "STRICTNESS: an alias to an undefined/unknown
  // anchor throws"). This just confirms merge implementation doesn't need to (and
  // must not) special-case its way around that existing guard.
  const text = "result:\n  <<: *undefined\n";
  throws(() => parse(text), (err: unknown) => err instanceof YAMLParseError);
  throws(() => jsyamlWithMerge(text));
  throws(() => yamlWithMerge(text));
});

// --------------------------------------------------------------------------
// M6 — cases that must NOT merge. These already hold TODAY (vacuously — nothing
// merges yet), and must keep holding once merge is implemented: each is a
// regression guard from day one, not a newly-red assertion.
// --------------------------------------------------------------------------

test('must NOT merge: << as a VALUE (not a key) stays the plain string "<<"', () => {
  const text = "a: <<\n";
  deepStrictEqual(parse(text), { a: "<<" });
  deepStrictEqual(parse(text), yamlWithMerge(text));
  // js-yaml's own merge-tag resolver — reachable only via its all-or-nothing
  // YAML11_SCHEMA opt-in (see file header) — matches "<<" as a plain scalar VALUE
  // too, not only as a key, and leaks its internal MERGE_KEY symbol rather than
  // the string "<<" (verified live: typeof result.a === "symbol"). The merge spec
  // (https://yaml.org/type/merge.html) only ever discusses "<<" as a KEY, so we
  // treat this as a js-yaml implementation quirk of its schema-wide opt-in, not a
  // competing semantic worth following — hence no jsyamlWithMerge equality
  // assertion above, just this documented, locked-in quirk.
  strictEqual(typeof (jsyamlWithMerge(text) as { a: unknown }).a, "symbol");
});

test('must NOT merge: a DOUBLE-quoted "<<" key is an ordinary string key, verified against both peers', () => {
  const text = 'result:\n  "<<": 1\n';
  deepStrictEqual(parse(text), { result: { "<<": 1 } });
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
  deepStrictEqual(parse(text), yamlWithMerge(text));
});

test("must NOT merge: a SINGLE-quoted '<<' key is an ordinary string key, verified against both peers", () => {
  const text = "result:\n  '<<': 1\n";
  deepStrictEqual(parse(text), { result: { "<<": 1 } });
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
  deepStrictEqual(parse(text), yamlWithMerge(text));
});

const notMergeKeyNames = [
  ["<<x (merge sigil as a prefix)", "<<x: 1\n", "<<x"],
  ["x<< (merge sigil as a suffix)", "x<<: 1\n", "x<<"],
] as const;

for (const [label, text, expectedKey] of notMergeKeyNames) {
  test(`must NOT merge: a key merely CONTAINING << is ordinary · ${label}`, () => {
    deepStrictEqual(parse(text), { [expectedKey]: 1 });
    deepStrictEqual(parse(text), jsyamlWithMerge(text));
    deepStrictEqual(parse(text), yamlWithMerge(text));
  });
}

// --------------------------------------------------------------------------
// M7 — round-trip: stringify never re-emits `<<` (we always dump the EXPANDED
// map — nothing recognizes `<<` as special on the way out), so re-parsing our
// own output must reproduce the same value. Round-trip by VALUE, not by text,
// per test/stringify.unit.ts's idiom (a dumper is free to reorder/requote).
// NOTE: this invariant is self-referential (parse -> stringify -> parse, all
// OUR code) and already holds TODAY against the current (unmerged) shape too —
// it isn't a merge-specific assertion, so don't be surprised if it's green
// before the feature lands; it's still worth locking so a real implementation
// can't regress it.
// --------------------------------------------------------------------------

const roundTripDocs = [
  "defaults: &d\n  adapter: postgres\n  host: localhost\ndevelopment:\n  <<: *d\n  database: dev_db\n",
  "a: &a\n  p: 1\nb: &b\n  p: 2\nresult:\n  <<: [*a, *b]\n",
  "a: &a\n  p: 1\n  q: 2\nresult:\n  <<: *a\n  p: 99\n",
] as const;

for (const text of roundTripDocs) {
  test(`round-trip: parse(stringify(parse(t))) deep-equals parse(t) · ${text.replace(/\n/g, "\\n").slice(0, 48)}`, () => {
    const once = parse(text);
    deepStrictEqual(parse(stringify(once)), once);
  });
}

// --------------------------------------------------------------------------
// M8 — flow mappings: the flow map parser is a separate code path from block
// maps and needs its own fix. Repeats the load-bearing cases above in flow form.
// --------------------------------------------------------------------------

const flowDocs = [
  ["basic merge", "a: &a {adapter: postgres, host: localhost}\nresult: {<<: *a, database: dev_db}\n"],
  ["sequence merge, earlier wins", "a: &a {p: 1}\nb: &b {p: 2}\nresult: {<<: [*a, *b]}\n"],
  ["override: own key wins over merged value", "a: &a {p: 1, q: 2}\nresult: {p: 99, <<: *a}\n"],
] as const;

for (const [label, text] of flowDocs) {
  test(`flow mapping · ${label}`, () => {
    deepStrictEqual(parse(text), jsyamlWithMerge(text));
    deepStrictEqual(parse(text), yamlWithMerge(text));
  });
}

test("flow mapping · error: an invalid merge source throws", () => {
  const text = "result: {<<: 5}\n";
  throws(() => parse(text), (err: unknown) => err instanceof YAMLParseError);
  throws(() => jsyamlWithMerge(text));
  throws(() => yamlWithMerge(text));
});

test('flow mapping · a quoted "<<" key does not merge', () => {
  const text = 'a: &a {p: 1}\nresult: {"<<": 1}\n';
  deepStrictEqual(parse(text), { a: { p: 1 }, result: { "<<": 1 } });
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
  deepStrictEqual(parse(text), yamlWithMerge(text));
});

// --------------------------------------------------------------------------
// M9 — interaction with existing documented deviations.
// --------------------------------------------------------------------------

test("interaction: duplicate << keys with the SAME anchor are idempotent (no error)", () => {
  const text = "a: &a\n  p: 1\nresult:\n  <<: *a\n  <<: *a\n";
  deepStrictEqual(parse(text), { a: { p: 1 }, result: { p: 1 } });
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
  deepStrictEqual(parse(text), yamlWithMerge(text));
});

// GENUINE SEMANTIC QUESTION (flagged in the result file for the orchestrator, per
// the task recipe). Two `<<` occurrences in one mapping share the literal key
// name "<<", so by ORDINARY mapping-key rules this looks like a duplicate key —
// and this repo's own documented deviation for duplicate keys generally is
// LAST-WINS (README's Decisions and deviations, for JSON.parse parity:
// `{a: 1, a: 2}` -> `{a: 2}`). Both peers do NOT apply that rule to duplicate `<<`
// keys — verified empirically (both directions, to rule out an alphabetical or
// declaration-unrelated tiebreak): multiple `<<` occurrences behave as an
// implicit merge SEQUENCE in declaration order, earlier wins on overlap — the
// SAME precedence `<<: [*first, *second]` uses, and the OPPOSITE precedence from
// this repo's general duplicate-key rule. We follow the peers here (the de facto
// oracle for this one feature — see the file header) rather than generalizing
// our own last-wins convention to merge keys.
test("interaction: duplicate << keys with DIFFERENT anchors merge in DECLARATION ORDER (earlier wins) — NOT last-wins", () => {
  const text = "a: &a\n  p: 1\nb: &b\n  p: 2\n  q: 3\nresult:\n  <<: *a\n  <<: *b\n";
  deepStrictEqual(parse(text), { a: { p: 1 }, b: { p: 2, q: 3 }, result: { p: 1, q: 3 } });
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
  deepStrictEqual(parse(text), yamlWithMerge(text));

  // Reversed declaration order flips which source wins — confirms the precedence
  // is genuinely position-based, not e.g. keyed off anchor name or definition site.
  const reversed = "a: &a\n  p: 1\nb: &b\n  p: 2\n  q: 3\nresult:\n  <<: *b\n  <<: *a\n";
  deepStrictEqual(parse(reversed), { a: { p: 1 }, b: { p: 2, q: 3 }, result: { p: 2, q: 3 } });
  deepStrictEqual(parse(reversed), jsyamlWithMerge(reversed));
  deepStrictEqual(parse(reversed), yamlWithMerge(reversed));
});

test("interaction: a merge result that is itself anchored and aliased elsewhere shares ONE reference", () => {
  const text = "a: &a\n  p: 1\nresult: &r\n  <<: *a\n  q: 2\nother: *r\n";
  const expected = { a: { p: 1 }, result: { p: 1, q: 2 }, other: { p: 1, q: 2 } };
  deepStrictEqual(parse(text), expected);
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
  deepStrictEqual(parse(text), yamlWithMerge(text));

  // Structural sharing, matching this repo's existing anchor/alias convention
  // (test/parser.unit.ts's "structural sharing: an alias resolves to the SAME
  // reference, not a deep copy") — the anchor captures the POST-merge object, and
  // the alias elsewhere must resolve to that exact object, not a fresh copy of it.
  const r = parse(text) as { result: object; other: object };
  strictEqual(r.other, r.result);
});

test("interaction: a merge source defined AFTER the merge site fails (define-before-use, like any alias)", () => {
  // Already throws today via the generic (non-merge-specific) alias mechanism —
  // confirmed this stays true once merge parses `<<: *a` as a real merge attempt.
  const text = "result:\n  <<: *a\na: &a\n  p: 1\n";
  throws(() => parse(text), (err: unknown) => err instanceof YAMLParseError);
  throws(() => jsyamlWithMerge(text));
  throws(() => yamlWithMerge(text));
});

// --------------------------------------------------------------------------
// M10 — security: a merged `__proto__` key must not pollute the prototype
// chain, exactly like an ORDINARY `__proto__` key already doesn't
// (test/parser.unit.ts's "__proto__ becomes an own property, does not
// pollute the prototype"). `applyMerge` copies through `storeKey`, never raw
// assignment, specifically so that guard still applies to a key arriving via
// `<<` rather than being written directly.
// --------------------------------------------------------------------------

test("security: a merged `__proto__` key becomes an own property, does not pollute the prototype", () => {
  const text = "a: &a\n  __proto__:\n    polluted: true\nresult:\n  <<: *a\n  safe: 1\n";
  const r = parse(text) as { result: Record<string, unknown> };
  deepStrictEqual(r.result, JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}'));
  ok(Object.prototype.hasOwnProperty.call(r.result, "__proto__"), "__proto__ is an OWN property of the merged-into map");
  strictEqual(Object.getPrototypeOf(r.result), Object.prototype, "the prototype chain itself is untouched");
  strictEqual((r as unknown as Record<string, unknown>).polluted, undefined, "the merge never reached the enclosing document's prototype");
  strictEqual(({} as Record<string, unknown>).polluted, undefined, "the global Object.prototype was never touched");
});

// --------------------------------------------------------------------------
// M11 — merge-eligibility is a property of the key node's own STYLE, not of
// the string it resolves to: a quoted `"<<"` and a bare `<<` resolve to the
// identical JS string, so the check has to look at the source, not the value.
//
// Every case is asserted at THREE positions — first key of a block mapping,
// a later key of that same mapping, and inside a flow mapping — because those
// are three different code paths in the parser, and an earlier revision of
// this feature merged correctly only in the first one.
// --------------------------------------------------------------------------

/** The same mapping written three ways, so one case can be checked in all of them. */
const AT_POSITIONS: ReadonlyArray<readonly [string, (entry: string) => string]> = [
  ["block, first key", (e) => `a: &a {c: 3}\nx:\n  ${e}\n  b: 2\n`],
  ["block, later key", (e) => `a: &a {c: 3}\nx:\n  b: 2\n  ${e}\n`],
  ["flow", (e) => `a: &a {c: 3}\nx: {${e}, b: 2}\n`],
] as const;

const ELIGIBLE: ReadonlyArray<readonly [string, string]> = [
  ["bare `<<`", "<<: *a"],
  ["anchored `&k <<` — an anchor is a node property, not a style change", "&k <<: *a"],
] as const;

const INELIGIBLE: ReadonlyArray<readonly [string, string]> = [
  ['double-quoted `"<<"`', '"<<": *a'],
  ["single-quoted `\'<<\'`", "'<<': *a"],
  ["tagged `!!str <<` — an explicit !!str IS a string, so it cannot also be the merge tag", "!!str <<: *a"],
] as const;

for (const [entryLabel, entry] of ELIGIBLE) {
  for (const [posLabel, build] of AT_POSITIONS) {
    test(`eligibility · ${entryLabel} · ${posLabel} · merges`, () => {
      const text = build(entry);
      deepStrictEqual((parse(text) as { x: unknown }).x, { c: 3, b: 2 });
      // Both peers agree, so this is parity rather than a house rule.
      deepStrictEqual(parse(text), yamlWithMerge(text));
      deepStrictEqual(parse(text), jsyamlWithMerge(text));
    });
  }
}

for (const [entryLabel, entry] of INELIGIBLE) {
  for (const [posLabel, build] of AT_POSITIONS) {
    test(`eligibility · ${entryLabel} · ${posLabel} · does NOT merge`, () => {
      const text = build(entry);
      deepStrictEqual((parse(text) as { x: unknown }).x, { "<<": { c: 3 }, b: 2 });
    });
  }
}

// `yaml` merges a TAGGED `!!str <<` where js-yaml (and we) don't. Locked
// deliberately so the divergence can't drift unnoticed: an explicit `!!str`
// makes the key a string, so it cannot also resolve to the merge tag.
test("eligibility · tagged `!!str <<` · js-yaml agrees with us; `yaml` is the outlier", () => {
  const text = "a: &a {c: 3}\nx:\n  !!str <<: *a\n  b: 2\n";
  const notMerged = { "<<": { c: 3 }, b: 2 };
  deepStrictEqual((parse(text) as { x: unknown }).x, notMerged);
  deepStrictEqual((jsyamlWithMerge(text) as { x: unknown }).x, notMerged);
  deepStrictEqual((yamlWithMerge(text) as { x: unknown }).x, { c: 3, b: 2 });
});

// The explicit `? key` form, in both block and flow mappings.
test("eligibility · explicit `? <<` · block · merges", () => {
  const text = "a: &a {c: 3}\nx:\n  ? <<\n  : *a\n  b: 2\n";
  deepStrictEqual((parse(text) as { x: unknown }).x, { c: 3, b: 2 });
  deepStrictEqual(parse(text), yamlWithMerge(text));
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
});

test("eligibility · explicit `? <<` · flow · merges", () => {
  const text = "a: &a {c: 3}\nx: {? <<: *a, b: 2}\n";
  deepStrictEqual((parse(text) as { x: unknown }).x, { c: 3, b: 2 });
  deepStrictEqual(parse(text), yamlWithMerge(text));
  deepStrictEqual(parse(text), jsyamlWithMerge(text));
});

test('eligibility · explicit `? "<<"` stays quoted, so it does NOT merge', () => {
  const text = 'a: &a {c: 3}\nx:\n  ? "<<"\n  : *a\n  b: 2\n';
  deepStrictEqual((parse(text) as { x: unknown }).x, { "<<": { c: 3 }, b: 2 });
});

test("eligibility · a valueless `? <<` is an error (merging nothing isn't a mapping) — both peers throw too", () => {
  const text = "x:\n  ? <<\n  b: 2\n";
  throws(() => parse(text), (err: unknown) => err instanceof YAMLParseError);
  throws(() => yamlWithMerge(text));
  throws(() => jsyamlWithMerge(text));
});
