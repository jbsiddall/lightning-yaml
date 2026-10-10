export function advanceToEnd(start, end) {
  if (start < 0 || end < start) return -1;
  let cursor = start;
  while (cursor < end) {
    cursor = cursor + 1;
  }
  return cursor;
}
