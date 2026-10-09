import assert from "node:assert/strict";
import { assertExactRows } from "./rowset.mjs";

const expected = ["parse/a", "parse/b", "stringify/a", "stringify/b"];
assertExactRows(expected, expected, "complete synthetic matrix");
assert.throws(() => assertExactRows(expected.slice(1), expected, "missing operation"), /row set differs/);
assert.throws(() => assertExactRows([...expected, "parse/a"], expected, "duplicate row"), /duplicate rows/);
assert.throws(() => assertExactRows([...expected, "stringify/c"], expected, "extra row"), /row set differs/);
console.log("row-set integrity self-test passed (complete, missing, duplicate, extra)");
