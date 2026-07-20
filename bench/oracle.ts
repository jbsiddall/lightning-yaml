/**
 * The differential oracle — a high-quality reference implementation we test
 * AGAINST, but NOT the definition of "correct". The definition of correct is the
 * YAML 1.2.2 spec, operationalized by the yaml-test-suite (scored in
 * `bench/conformance/`). This library is a differential AID: a disagreement between
 * lightning-yaml and it flags a *candidate* to investigate, and the spec — not this
 * library — adjudicates. Where this library diverges from the spec, the spec wins
 * and lightning-yaml deliberately matches the spec against it (e.g. rejecting `!!bool
 * yes` — `yes` is not a YAML-1.2 core-schema boolean — where `yaml` leniently returns
 * the string `"yes"`; see CLAUDE.md's source-of-truth precedence
 * and `site/src/content/docs/research/notes/2026-07-12-adversarial-torture-tests.md`).
 *
 * We do NOT cross-check every competitor against every other (js-yaml and yaml
 * legitimately disagree — e.g. on timestamps, and generally because js-yaml
 * targets YAML 1.1 while `yaml` targets 1.2). We pick ONE reference aid: `yaml`
 * (github.com/eemeli/yaml) — it implements YAML 1.1 **and** 1.2 and is the most
 * spec-compliant of the JS parsers (it passes the yaml-test-suite most thoroughly),
 * i.e. the aid that diverges from spec least often — and, verified empirically,
 * parses the constructs our fixtures exercise faithfully: `!!binary` → `Uint8Array`,
 * and `&anchor`/`*alias` → real shared references. Its residual spec-divergences are
 * documented where they bite.
 *
 * Used in two places:
 *   - fixtures: to turn YAML fixture text into the in-memory value the stringify
 *     benchmarks serialize (`loadFixtureValue`); the fixtures deliberately avoid
 *     spec-contested constructs, so this library's output there is spec-faithful;
 *   - tests: as the reference `parse`/`stringify` the consistency suite compares
 *     lightning-yaml against — sound only where this library agrees with the spec.
 *
 * To change the reference aid, change it here — nothing else references a competitor
 * by name.
 */

import { parse as yamlParse, stringify as yamlStringify, type ScalarTag } from "yaml";

/** Human-readable name of the oracle library (for messages/docs). */
export const ORACLE_NAME = "yaml";

/**
 * Normalize `!!binary` to a plain `Uint8Array`. `yaml`'s default resolver hands
 * back a Node `Buffer`, but a `Buffer` and a byte-identical `Uint8Array` are NOT
 * deep-equal (vitest/Node compare the constructor, so `toEqual` reports them
 * unequal). We standardize on `Uint8Array` — the portable browser+Node type and
 * the contract documented throughout this repo — so the correctness gate accepts
 * a spec-compliant parser instead of demanding a Node-specific `Buffer`.
 */
const binaryToUint8Array: ScalarTag = {
  tag: "tag:yaml.org,2002:binary",
  resolve(str: string): Uint8Array {
    const bytes = Buffer.from(str.replace(/\s/g, ""), "base64");
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  },
};

/**
 * Parse options:
 *  - `maxAliasCount: -1` disables `yaml`'s default 100-alias "billion laughs" DoS
 *    guard. Our rich fixtures deliberately reuse anchors thousands of times and
 *    are trusted (we generate them); the cap guards untrusted input, not parse
 *    correctness.
 *  - `customTags` swaps in the Uint8Array binary resolver above.
 */
const PARSE_OPTIONS = { maxAliasCount: -1, customTags: [binaryToUint8Array] };

/** Parse text into the canonical JS value. */
export function oracleParse(text: string): unknown {
  return yamlParse(text, PARSE_OPTIONS);
}

/** Serialize a JS value into canonical YAML text. */
export function oracleStringify(value: unknown): string {
  return yamlStringify(value);
}
