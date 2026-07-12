/**
 * Consistency suite — the correctness gate for lightning-yaml.
 *
 * The plan: build a custom YAML parser, but only trust its benchmark numbers
 * once it produces the *right* answers. "Right" is defined by a single oracle —
 * the `yaml` library, the most spec-compliant JS parser (see bench/oracle.ts).
 * We check OUR implementation against the oracle over the exact same data the
 * benchmarks use; we deliberately do NOT cross-check the competitors against
 * each other.
 *
 * Two properties per fixture:
 *   - parse:     ours.parse(text) deep-equals oracle.parse(text).
 *   - stringify: oracle.parse(ours.stringify(value)) deep-equals value — i.e.
 *     ours serializes to something the oracle reads back unchanged. (Two YAML
 *     writers can emit different-but-equivalent text, so a round-trip through
 *     the oracle is the right check, not textual equality.)
 *
 * Today `lightning-yaml` is a stub whose parse/stringify throw, so every test
 * here is expected to FAIL. That's intentional: the framework is ready, and each
 * red test is a concrete spec for the parser to satisfy in a later PR.
 */

import { describe, it, expect } from "vitest";
import { datasets, loadFixtureText, loadFixtureValue } from "../bench/fixtures/datasets.ts";
import { candidatesInGroup, candidateAppliesTo } from "../bench/candidates.ts";
import { oracleParse, ORACLE_NAME } from "../bench/oracle.ts";

// Subjects under test = our implementation(s). Adding another parser to group
// "ours" would extend the suite automatically.
const subjects = candidatesInGroup("ours");

// Exercise every benchmark dataset except the 10 MB one — parsing that with the
// oracle inside the test process is needlessly heavy for a consistency check.
const TEST_DATASETS = datasets.filter((ds) => ds.bytes <= 1_000_000);

for (const subject of subjects) {
  describe(`${subject.name} vs. ${ORACLE_NAME} (oracle)`, () => {
    for (const ds of TEST_DATASETS) {
      if (candidateAppliesTo(subject, ds, "parse")) {
        it(`parse matches oracle · ${ds.name}`, () => {
          const text = loadFixtureText(ds);
          // Call ours FIRST: while it's a stub this throws immediately, so the
          // (heavy) oracle parse never runs for the still-unimplemented case.
          const actual = subject.parse(text);
          expect(actual).toEqual(oracleParse(text));
        });
      }

      if (candidateAppliesTo(subject, ds, "stringify")) {
        it(`stringify round-trips through oracle · ${ds.name}`, () => {
          const value = loadFixtureValue(ds);
          const text = subject.stringify(value);
          expect(oracleParse(text)).toEqual(value);
        });
      }

      // `toEqual` is structural — it ignores object identity — so it can't tell
      // a resolved `*alias` (a shared reference) from a fresh deep copy. Losing
      // that sharing would balloon memory, defeating the whole point. Rich
      // fixtures reuse a small pool of `cfg` objects via anchors, so assert that
      // ours reconstructs the same shared-reference graph the oracle does.
      if (ds.category === "yaml-rich") {
        it(`preserves anchor/alias sharing · ${ds.name}`, () => {
          const text = loadFixtureText(ds);
          const ours = subject.parse(text) as Array<{ cfg: unknown }>;
          const ref = oracleParse(text) as Array<{ cfg: unknown }>;
          const pair = findAliasedPair(ref);
          expect(pair, "fixture should contain an aliased pair").not.toBeNull();
          const [i, j] = pair!;
          expect(ours[i].cfg, "aliases must resolve to one shared object").toBe(ours[j].cfg);
        });
      }
    }
  });
}

/** First index pair whose `cfg` is the *same object* (i.e. an anchor/alias reuse). */
function findAliasedPair(items: Array<{ cfg: unknown }>): [number, number] | null {
  const firstSeenAt = new Map<unknown, number>();
  for (let j = 0; j < items.length; j++) {
    const cfg = items[j].cfg;
    const i = firstSeenAt.get(cfg);
    if (i !== undefined) return [i, j];
    firstSeenAt.set(cfg, j);
  }
  return null;
}
