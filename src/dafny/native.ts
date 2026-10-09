import { YAMLParseError } from '../errors.ts';

export type NativeValue = unknown;
export type NativeMap = Map<NativeValue, NativeValue>;
export type NativeSet = Set<NativeValue>;

export const Native = Object.freeze({
  __default: Object.freeze({
  _$$_toString(value: unknown): string { return String(value); },
  nullValue: null,
  undefinedValue: undefined,
  noDocumentValue: Symbol('no-document'),
  notNumericValue: Symbol('not-numeric'),
  emptyMap: null,
  numberAsCounter(value: unknown): number { return value as number; },
  numberMulAdd(accumulator: unknown, radix: number, digit: number): number {
    return (accumulator as number) * radix + digit;
  },
  numberNegate(value: unknown): number { return -(value as number); },
  numberAdd(left: unknown, right: unknown): number { return (left as number) + (right as number); },
  numberLessEqual(left: unknown, right: unknown): boolean { return (left as number) <= (right as number); },
  jsonQuote(text: string): string { return JSON.stringify(text); },
  slice(s: string, from: number, to: number): string { return s.slice(from, to); },
  parseNumber(s: string): number { return Number(s); },
  parseSpecialNumber(s: string): number { return Number(s); },
  stringValue(s: string): string { return s; },
  boolValue(value: boolean): boolean { return value; },
  numberValue(value: number): number { return value; },
  toString(value: unknown): string { return String(value); },
  stringFallback(value: unknown): string { return String(value); },
  stringLength(s: string): number { return s.length; },
  codeUnitAt(s: string, i: number): number { return s.charCodeAt(i); },
  indexOf(s: string, needle: string, from: number): number { return s.indexOf(needle, from); },
  concat(a: string, b: string): string { return a + b; },
  repeat(s: string, count: number): string { return s.repeat(count); },
  join(parts: unknown, separator: string): string {
    if (!Array.isArray(parts)) throw new TypeError('Expected native array');
    return parts.join(separator);
  },
  isNull(value: unknown): boolean { return value === null; },
  isUndefined(value: unknown): boolean { return value === undefined; },
  isObject(value: unknown): boolean { return typeof value === 'object' && value !== null; },
  isArray(value: unknown): boolean { return Array.isArray(value); },
  isMap(value: unknown): boolean { return value instanceof Map; },
  isSet(value: unknown): boolean { return value instanceof Set; },
  isUint8Array(value: unknown): boolean { return value instanceof Uint8Array; },
  isBoolean(value: unknown): boolean { return typeof value === 'boolean'; },
  isNumber(value: unknown): boolean { return typeof value === 'number'; },
  isString(value: unknown): boolean { return typeof value === 'string'; },
  booleanValue(value: unknown): boolean { return value as boolean; },
  numberIsNaN(value: unknown): boolean { return typeof value === 'number' && Number.isNaN(value); },
  numberIsPositiveInfinity(value: unknown): boolean { return value === Infinity; },
  numberIsNegativeInfinity(value: unknown): boolean { return value === -Infinity; },
  numberIsNegativeZero(value: unknown): boolean { return Object.is(value, -0); },
  formatNumber(value: unknown): string { return String(value); },
  stringValueOf(value: unknown): string { return value as string; },
  byteLength(value: unknown): number {
    if (!(value instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
    return value.length;
  },
  byteGet(value: unknown, i: number): number {
    if (!(value instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
    return value[i];
  },
  createUint8Array(length: number): Uint8Array { return new Uint8Array(length); },
  byteSet(value: unknown, i: number, byte: number): void {
    (value as Uint8Array)[i] = byte;
  },
  stringFromCharCode(value: number): string { return String.fromCharCode(value); },
  stringFromCodePoint(value: number): string { return String.fromCodePoint(value); },
  sameValue(left: unknown, right: unknown): boolean { return Object.is(left, right); },
  jsEqual(left: unknown, right: unknown): boolean { return left === right; },
  euclideanDivisionNumber(a: number, b: number): number {
    if (a >= 0) return b >= 0 ? Math.floor(a / b) : -Math.floor(a / -b);
    return b >= 0 ? -Math.floor((-a - 1) / b) - 1 : Math.floor((-a - 1) / -b) + 1;
  },
  euclideanModuloNumber(a: number, b: number): number {
    const divisor = Math.abs(b);
    if (a >= 0) return a % divisor;
    const remainder = (-a) % divisor;
    return remainder === 0 ? remainder : divisor - remainder;
  },
  createArray(): unknown[] { return []; },
  arrayPush(array: unknown, value: unknown): void { (array as unknown[]).push(value); },
  arrayLength(array: unknown): number { return (array as unknown[]).length; },
  arrayGet(array: unknown, i: number): unknown { return (array as unknown[])[i]; },
  arraySet(array: unknown, i: number, value: unknown): void { (array as unknown[])[i] = value; },
  createObject(): Record<string, unknown> { return {}; },
  objectGet(object: unknown, key: string): unknown { return (object as Record<string, unknown>)[key]; },
  objectSet(object: unknown, key: string, value: unknown): void { (object as Record<string, unknown>)[key] = value; },
  objectSetSafe(object: unknown, key: string, value: unknown): void {
    if (key.charCodeAt(0) === 95 && key === '__proto__') Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
    else (object as Record<string, unknown>)[key] = value;
  },
  objectHasOwn(object: unknown, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); },
  objectKeys(object: unknown): string[] { return Object.keys(object as object); },
  mapCreate(): NativeMap { return new Map(); },
  mapHas(map: unknown, key: unknown): boolean { return (map as NativeMap).has(key); },
  mapGet(map: unknown, key: unknown): unknown { return (map as NativeMap).get(key); },
  mapSet(map: unknown, key: unknown, value: unknown): void { (map as NativeMap).set(key, value); },
  mapSize(map: unknown): number { return (map as NativeMap).size; },
  mapKeys(value: unknown): unknown[] { return Array.from((value as NativeMap).keys()); },
  mapValue(map: unknown): unknown { return map; },
  mapFromValue(value: unknown): NativeMap { return value as NativeMap; },
  setCreate(): NativeSet { return new Set(); },
  setHas(set: unknown, value: unknown): boolean { return (set as NativeSet).has(value); },
  setAdd(set: unknown, value: unknown): void { (set as NativeSet).add(value); },
  setValues(value: unknown): unknown[] { return Array.from((value as NativeSet).values()); },
  setValue(set: unknown): unknown { return set; },
  fail(message: string): never { throw new YAMLParseError(message); },
  }),
});
