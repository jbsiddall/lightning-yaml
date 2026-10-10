// Graph comparison preserves aliases/cycles and distinguishes container types.
export function sameGraph(left, right, leftSeen = new WeakMap(), rightSeen = new WeakMap()) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (leftSeen.has(left)) return leftSeen.get(left) === right;
  if (rightSeen.has(right)) return false;
  if (left.constructor !== right.constructor) return false;
  leftSeen.set(left, right);
  rightSeen.set(right, left);

  if (left instanceof Uint8Array) {
    return right instanceof Uint8Array && left.length === right.length && left.every((v, i) => v === right[i]);
  }
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((v, i) => sameGraph(v, right[i], leftSeen, rightSeen));
  }
  if (left instanceof Map) {
    if (!(right instanceof Map) || left.size !== right.size) return false;
    const a = [...left.entries()], b = [...right.entries()];
    return a.every(([k, v], i) => sameGraph(k, b[i][0], leftSeen, rightSeen) && sameGraph(v, b[i][1], leftSeen, rightSeen));
  }
  if (left instanceof Set) {
    if (!(right instanceof Set) || left.size !== right.size) return false;
    const a = [...left.values()], b = [...right.values()];
    return a.every((v, i) => sameGraph(v, b[i], leftSeen, rightSeen));
  }
  const aKeys = Reflect.ownKeys(left), bKeys = Reflect.ownKeys(right);
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) return false;
  return aKeys.every((key) => sameGraph(left[key], right[key], leftSeen, rightSeen));
}
