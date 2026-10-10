import assert from "node:assert/strict";

export function assertExactRows(actual, expected, label) {
  const sortedExpected = [...expected].sort();
  const sortedActual = [...actual].sort();
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate rows`);
  assert.deepEqual(sortedActual, sortedExpected, `${label}: row set differs`);
}
