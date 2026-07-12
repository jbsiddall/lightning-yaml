/**
 * Deep-equality used to score positive conformance cases: a parser's parsed
 * document sequence against the expected sequence decoded from `in.json`.
 *
 *   - object key order is irrelevant ({a:1,b:2} == {b:2,a:1});
 *   - numbers compare with Object.is after normalizing -0 -> 0, so -0 == 0
 *     but NaN would (correctly) only equal NaN — not reachable from JSON
 *     anyway, since JSON has no NaN literal;
 *   - arrays and plain objects are never equal to each other, even both empty.
 */

function normalizeNumber(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Object.is(normalizeNumber(a), normalizeNumber(b));
  }
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }

  return false;
}

/** Deep-equal over an ordered sequence of documents (order matters). */
export function deepEqualSequences(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!deepEqual(a[i], b[i])) return false;
  }
  return true;
}
