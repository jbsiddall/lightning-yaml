/**
 * Harness sanity — validates the fixtures and the oracle wiring independently of
 * lightning-yaml. These tests are expected to PASS: they prove the test
 * framework and comparison machinery work, so a red test in consistency.test.ts
 * unambiguously means "ours is wrong", not "the harness is broken".
 */

import { describe, it, expect } from "vitest";
import { datasets, loadFixtureText, loadFixtureValue } from "../bench/fixtures/datasets.ts";
import { oracleParse, oracleStringify, ORACLE_NAME } from "../bench/oracle.ts";

const TEST_DATASETS = datasets.filter((ds) => ds.bytes <= 1_000_000);

describe(`fixtures parse under the ${ORACLE_NAME} oracle`, () => {
  for (const ds of TEST_DATASETS) {
    it(`parses ${ds.name} deterministically`, () => {
      const text = loadFixtureText(ds);
      expect(oracleParse(text)).toEqual(oracleParse(text));
    });

    // Value round-trip (value → text → value) is stable for JSON-compatible
    // data. Rich fixtures use `!!binary`, which the oracle parses to a
    // Uint8Array but re-emits (by default) as a number array, so their full
    // value round-trip isn't stable — determinism above is the guarantee there.
    if (ds.category !== "yaml-rich") {
      it(`round-trips ${ds.name} (value → text → value)`, () => {
        const value = loadFixtureValue(ds);
        expect(oracleParse(oracleStringify(value))).toEqual(value);
      });
    }
  }
});

describe("fixtures exercise the syntax their category promises", () => {
  for (const ds of datasets.filter((d) => d.category === "yaml-rich")) {
    it(`${ds.name} uses !!binary and anchors/aliases`, () => {
      const text = loadFixtureText(ds);
      expect(text, "expected a !!binary tag").toMatch(/!!binary/);
      expect(text, "expected an &anchor").toMatch(/(^|\s)&\w/m);
      expect(text, "expected a *alias").toMatch(/(^|\s)\*\w/m);
    });
  }

  for (const ds of datasets.filter((d) => d.category === "yaml-plain")) {
    it(`${ds.name} uses no tags or anchors (just JSON data in YAML syntax)`, () => {
      const text = loadFixtureText(ds);
      expect(text, "plain YAML should have no explicit tags").not.toMatch(/!!/);
      expect(text, "plain YAML should have no anchors/aliases").not.toMatch(/(^|\s)[&*]\w/m);
    });
  }
});
