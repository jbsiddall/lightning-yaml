import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSuite } from "../bench/conformance/suite.ts";

test("an `error` marker outranks a stale in.json", () => {
  const root = mkdtempSync(join(tmpdir(), "suite-"));
  try {
    const dir = join(root, "ABCD");
    mkdirSync(dir);
    writeFileSync(join(dir, "in.yaml"), "a: b\n");
    writeFileSync(join(dir, "in.json"), '{"a":"b"}');
    writeFileSync(join(dir, "error"), "");
    assert.equal(loadSuite(root)[0]!.kind, "negative");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
