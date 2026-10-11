import { test } from "@fast-check/vitest";
import fc from "fast-check";
import { describe, expect } from "vitest";
import {
  combinedTokenIdentity,
  evaluateCST,
  firstDifference,
  identityTopology,
  MAIN_SHIM_MISSING_CAPABILITIES,
} from "./cst.js";

const scalar = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }).map(String),
  fc.boolean().map(String),
  fc.constantFrom("null", "~", "plain", "'quoted text'", '"quoted text"'),
);
const key = fc.constantFrom("alpha", "beta_2", "item", "name", "value");

describe("yaml CST pipeline comparison", () => {
  test.prop([fc.dictionary(key, scalar, { minKeys: 1, maxKeys: 5 })], {
    numRuns: 80,
  })(
    "compares actual tokens, node ranges and values for a bounded scalar mapping grammar",
    async (mapping) => {
      const source = Object.entries(mapping)
        .map(([k, v]) => `${k}: ${v}\n`)
        .join("");
      const row = await evaluateCST(source);
      expect(row.status).toBe("success");
      expect(row.reference?.status).toBe("success");
      expect(row.reconstructionEqual).toBe(true);
      expect(row.tokens?.length).toBeGreaterThan(0);
      expect(row.documents?.length).toBe(1);
      for (const diff of row.differences ?? []) {
        expect([
          "tokens",
          "documents",
          "nodes",
          "source-token-identity",
        ]).toContain(diff.category);
        if (diff.category === "source-token-identity") {
          expect(diff.path).toContain(".backref");
          continue;
        }
        expect([
          "$.tokens.0.value.items.0.value.indent",
          "$.documents.0.directives.docStart",
          "$.nodes.0.anchor",
        ]).toContain(diff.path);
      }
      expect(row.differences?.some((d) => d.category === "tokens")).toBe(true);
      expect(row.differences?.some((d) => d.category === "nodes")).toBe(true);
      expect(row.differences?.some((d) => d.category === "values")).toBe(false);
    },
  );

  test.each([
    "# only a comment\n",
    "\uFEFFname: value\r\nnext: [1, 2]\r\n",
    "---\na: 1\n---\nb: 2\n",
    "%YAML 1.2\n---\nitems:\n  - one\n  - two\n",
    "flow: {a: [1, 2], b: 'x'} # end\n",
    "anchor: &a {x: 1}\nalias: *a\n",
    "a: [1, 2\n",
    'key: "unfinished\n',
    "\n",
  ])("records exact CST behavior for source %j", async (source) => {
    const row = await evaluateCST(source);
    expect(row.reference).toBeDefined();
    expect(row.tokens).toBeDefined();
    expect(row.tokenTypes).toBeDefined();
    expect(row.lineCounter?.lineStarts).toBeDefined();
    expect(row.differences).toBeDefined();
  });

  test("detects mutation of token offsets, source and comments", () => {
    expect(
      firstDifference(
        { offset: 1, source: "x", comment: "# c" },
        { offset: 2, source: "x", comment: "# c" },
      ),
    ).toContain("offset");
    expect(
      firstDifference(
        { offset: 1, source: "x", comment: "# c" },
        { offset: 1, source: "y", comment: "# c" },
      ),
    ).toContain("source");
    expect(
      firstDifference(
        { offset: 1, source: "x", comment: "# c" },
        { offset: 1, source: "x", comment: "# d" },
      ),
    ).toContain("comment");
  });

  test("detects shared versus duplicated references in both CST and AST snapshots", () => {
    const shared = { x: 1 };
    const withSharing = { a: shared, b: shared };
    const duplicated = { a: { x: 1 }, b: { x: 1 } };
    expect(firstDifference(duplicated, withSharing)).toBeDefined();
    expect(firstDifference(withSharing, duplicated)).toBeDefined();
    expect(identityTopology(duplicated)).not.toEqual(
      identityTopology(withSharing),
    );
    expect(
      firstDifference(withSharing, { a: shared, b: shared }),
    ).toBeUndefined();
  });

  test("detects when a node source token is cloned instead of attached to its parser token", () => {
    const parserToken = { type: "scalar", offset: 0, source: "value" };
    const attached = combinedTokenIdentity([parserToken], [parserToken]);
    const cloned = combinedTokenIdentity([parserToken], [{ ...parserToken }]);
    expect(attached).not.toEqual(cloned);
  });

  test("records node range and diagnostics gaps as their own CST layers", async () => {
    const nodeRow = await evaluateCST("alpha: false\n");
    expect(nodeRow.differences?.some((d) => d.category === "nodes")).toBe(true);
    expect(nodeRow.nodes).toBeDefined();
    const invalid = await evaluateCST("key: [1, 2\n");
    expect(invalid.diagnostics).toBeDefined();
    expect(invalid.reference?.status).toBeDefined();
  });

  test("tracks offsets in JavaScript UTF-16 units and reports the current main-shim API gap", async () => {
    const source = "x: 😀\r\ny: 2\n";
    const row = await evaluateCST(source);
    expect(row.lineCounter?.positions).toContainEqual({
      offset: source.length,
      line: 3,
      col: 1,
    });
    expect(MAIN_SHIM_MISSING_CAPABILITIES).toContain(
      "Parser (CST token generator)",
    );
    expect(row.mainShimMissingCapabilities).toEqual(
      MAIN_SHIM_MISSING_CAPABILITIES,
    );
  });
});
