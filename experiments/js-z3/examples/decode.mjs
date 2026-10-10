import { hexNibble } from './digits.mjs';

export function decodeHexPair(highCode, lowCode) {
  const high = hexNibble(highCode);
  const low = hexNibble(lowCode);
  if (high < 0 || low < 0) return -1;
  return 16 * high + low;
}
