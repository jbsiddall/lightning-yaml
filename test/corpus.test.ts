/**
 * Real-world corpus test — parse a large, in-the-wild YAML document end to end.
 *
 * The generated fixtures (bench/fixtures) are synthetic and reproducible, which
 * is what benchmarks need but means they never exercise the messy shapes real
 * hand-written YAML takes. This test pins one real document that has tripped up
 * YAML parsers in other languages: the CurrencyCloud API Swagger 2.0 spec
 * (~24k lines, ~880 KB, hundreds of folded/literal block scalars and thousands
 * of single-quoted scalars, no tags/anchors). It is vendored verbatim in
 * test/corpus/ (with a source-URL header comment) rather than fetched, so the
 * test is hermetic and offline.
 *
 * Two guarantees, mirroring the consistency suite's correctness model:
 *   - parse:     ours.parse(text) deep-equals the `yaml` oracle (bench/oracle.ts).
 *   - round-trip: the parsed value survives ours.stringify → parse unchanged,
 *     and the stringified text is valid YAML the independent oracle reads back
 *     unchanged too.
 *
 * We deliberately do NOT assert exact-string round-trip (stringify(parse(text))
 * === text). No conformant YAML library round-trips text byte-for-byte: parsing
 * discards presentation (comments, folded vs. literal vs. plain scalar style,
 * quoting, line-wrap width, key order). Re-emitting picks canonical styles, so
 * the bytes differ while the *value* is identical — and the value is what a
 * parser must preserve. That value-level round-trip is what we assert here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { parse, stringify } from "../src/index.ts";
import { oracleParse, ORACLE_NAME } from "../bench/oracle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "corpus", "currencycloud-reference.yaml");
const text = readFileSync(fixturePath, "utf8");

describe("real-world corpus · CurrencyCloud Swagger reference.yaml", () => {
  it("is the expected large real-world document", () => {
    // Guards against a truncated/empty checkout silently making the round-trip
    // assertions trivially pass.
    expect(text.length).toBeGreaterThan(800_000);
    expect(parse(text)).toMatchObject({ swagger: "2.0" });
  });

  it(`parse matches the ${ORACLE_NAME} oracle`, () => {
    expect(parse(text)).toEqual(oracleParse(text));
  });

  it("value round-trips through our own parse ∘ stringify", () => {
    const value = parse(text);
    expect(parse(stringify(value))).toEqual(value);
  });

  it(`our stringify output is valid YAML the ${ORACLE_NAME} oracle reads back unchanged`, () => {
    const value = parse(text);
    expect(oracleParse(stringify(value))).toEqual(value);
  });
});
