import { describe, expect, test } from "vitest";
import {
  combinedTokenIdentity,
  firstDifference,
  identityTopology,
} from "./evaluate.js";

describe("CST structural helpers", () => {
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

  test("detects shared versus duplicated references", () => {
    const shared = { x: 1 };
    const withSharing = { a: shared, b: shared };
    const duplicated = { a: { x: 1 }, b: { x: 1 } };
    expect(firstDifference(duplicated, withSharing)).toBeDefined();
    expect(firstDifference(withSharing, duplicated)).toBeDefined();
    expect(identityTopology(duplicated)).not.toEqual(
      identityTopology(withSharing),
    );
    expect(firstDifference(withSharing, { a: shared, b: shared })).toBeUndefined();
  });

  test("detects when a source token was cloned", () => {
    const parserToken = { type: "scalar", offset: 0, source: "value" };
    expect(combinedTokenIdentity([parserToken], [parserToken])).not.toEqual(
      combinedTokenIdentity([parserToken], [{ ...parserToken }]),
    );
  });
});
