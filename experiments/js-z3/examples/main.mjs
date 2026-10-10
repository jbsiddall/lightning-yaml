import { decodeHexPair } from './decode.mjs';
import { addTwoForward } from './offsets.mjs';

export function yamlEscapeValue(highCode, lowCode) {
  return decodeHexPair(highCode, lowCode);
}

export function safeOffset(value) {
  return addTwoForward(value);
}
