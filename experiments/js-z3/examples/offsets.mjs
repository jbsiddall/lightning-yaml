export function addTwoForward(value) {
  if (value > 9007199254740989) return -1;
  return value + 2;
}

export function addTwoReverse(value) {
  if (value <= 9007199254740989) return value + 2;
  return -1;
}
