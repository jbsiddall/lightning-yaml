import { YAMLParseError } from '../errors.ts';

export type NativeValue = unknown;
export type NativeMap = Map<NativeValue, NativeValue>;
export type NativeSet = Set<NativeValue>;

export const native_$$_toString = function _$$_toString(value: unknown): string { return String(value); };
export const nativeNullValue = null;
export const nativeUndefinedValue = undefined;
export const nativeNoDocumentValue = Symbol('no-document');
export const nativeNotNumericValue = Symbol('not-numeric');
export const nativeEmptyMap = null;
export const nativeNumberAsCounter = function numberAsCounter(value: unknown): number { return value as number; };
export const nativeNumberMulAdd = function numberMulAdd(accumulator: unknown, radix: number, digit: number): number {
    return (accumulator as number) * radix + digit;
  };
export const nativeNumberNegate = function numberNegate(value: unknown): number { return -(value as number); };
export const nativeNumberAdd = function numberAdd(left: unknown, right: unknown): number { return (left as number) + (right as number); };
export const nativeNumberLessEqual = function numberLessEqual(left: unknown, right: unknown): boolean { return (left as number) <= (right as number); };
export const nativeJsonQuote = function jsonQuote(text: string): string { return JSON.stringify(text); };
export const nativeSlice = function slice(s: string, from: number, to: number): string { return s.slice(from, to); };
export const nativeParseNumber = function parseNumber(s: string): number { return Number(s); };
export const nativeParseSpecialNumber = function parseSpecialNumber(s: string): number { return Number(s); };
export const nativeStringValue = function stringValue(s: string): string { return s; };
export const nativeBoolValue = function boolValue(value: boolean): boolean { return value; };
export const nativeNumberValue = function numberValue(value: number): number { return value; };
export const nativeToString = function toString(value: unknown): string { return String(value); };
export const nativeStringFallback = function stringFallback(value: unknown): string { return String(value); };
export const nativeStringLength = function stringLength(s: string): number { return s.length; };
export const nativeCodeUnitAt = function codeUnitAt(s: string, i: number): number { return s.charCodeAt(i); };
export const nativeIndexOf = function indexOf(s: string, needle: string, from: number): number { return s.indexOf(needle, from); };
export const nativeConcat = function concat(a: string, b: string): string { return a + b; };
export const nativeRepeat = function repeat(s: string, count: number): string { return s.repeat(count); };
export const nativeJoin = function join(parts: unknown, separator: string): string {
    if (!Array.isArray(parts)) throw new TypeError('Expected native array');
    return parts.join(separator);
  };
export const nativeIsNull = function isNull(value: unknown): boolean { return value === null; };
export const nativeIsUndefined = function isUndefined(value: unknown): boolean { return value === undefined; };
export const nativeIsObject = function isObject(value: unknown): boolean { return typeof value === 'object' && value !== null; };
export const nativeIsArray = function isArray(value: unknown): boolean { return Array.isArray(value); };
export const nativeIsMap = function isMap(value: unknown): boolean { return value instanceof Map; };
export const nativeIsSet = function isSet(value: unknown): boolean { return value instanceof Set; };
export const nativeIsUint8Array = function isUint8Array(value: unknown): boolean { return value instanceof Uint8Array; };
export const nativeIsBoolean = function isBoolean(value: unknown): boolean { return typeof value === 'boolean'; };
export const nativeIsNumber = function isNumber(value: unknown): boolean { return typeof value === 'number'; };
export const nativeIsString = function isString(value: unknown): boolean { return typeof value === 'string'; };
export const nativeBooleanValue = function booleanValue(value: unknown): boolean { return value as boolean; };
export const nativeNumberIsNaN = function numberIsNaN(value: unknown): boolean { return typeof value === 'number' && Number.isNaN(value); };
export const nativeNumberIsPositiveInfinity = function numberIsPositiveInfinity(value: unknown): boolean { return value === Infinity; };
export const nativeNumberIsNegativeInfinity = function numberIsNegativeInfinity(value: unknown): boolean { return value === -Infinity; };
export const nativeNumberIsNegativeZero = function numberIsNegativeZero(value: unknown): boolean { return Object.is(value, -0); };
export const nativeFormatNumber = function formatNumber(value: unknown): string { return String(value); };
export const nativeStringValueOf = function stringValueOf(value: unknown): string { return value as string; };
export const nativeByteLength = function byteLength(value: unknown): number {
    if (!(value instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
    return value.length;
  };
export const nativeByteGet = function byteGet(value: unknown, i: number): number {
    if (!(value instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
    return value[i];
  };
export const nativeCreateUint8Array = function createUint8Array(length: number): Uint8Array { return new Uint8Array(length); };
export const nativeByteSet = function byteSet(value: unknown, i: number, byte: number): void {
    (value as Uint8Array)[i] = byte;
  };
export const nativeStringFromCharCode = function stringFromCharCode(value: number): string { return String.fromCharCode(value); };
export const nativeStringFromCodePoint = function stringFromCodePoint(value: number): string { return String.fromCodePoint(value); };
export const nativeSameValue = function sameValue(left: unknown, right: unknown): boolean { return Object.is(left, right); };
export const nativeJsEqual = function jsEqual(left: unknown, right: unknown): boolean { return left === right; };
export const nativeEuclideanDivisionNumber = function euclideanDivisionNumber(a: number, b: number): number {
    if (a >= 0) return b >= 0 ? Math.floor(a / b) : -Math.floor(a / -b);
    return b >= 0 ? -Math.floor((-a - 1) / b) - 1 : Math.floor((-a - 1) / -b) + 1;
  };
export const nativeEuclideanModuloNumber = function euclideanModuloNumber(a: number, b: number): number {
    const divisor = Math.abs(b);
    if (a >= 0) return a % divisor;
    const remainder = (-a) % divisor;
    return remainder === 0 ? remainder : divisor - remainder;
  };
export const nativeCreateArray = function createArray(): unknown[] { return []; };
export const nativeArrayPush = function arrayPush(array: unknown, value: unknown): void { (array as unknown[]).push(value); };
export const nativeArrayLength = function arrayLength(array: unknown): number { return (array as unknown[]).length; };
export const nativeArrayGet = function arrayGet(array: unknown, i: number): unknown { return (array as unknown[])[i]; };
export const nativeArraySet = function arraySet(array: unknown, i: number, value: unknown): void { (array as unknown[])[i] = value; };
export const nativeCreateObject = function createObject(): Record<string, unknown> { return {}; };
export const nativeObjectGet = function objectGet(object: unknown, key: string): unknown { return (object as Record<string, unknown>)[key]; };
export const nativeObjectSet = function objectSet(object: unknown, key: string, value: unknown): void { (object as Record<string, unknown>)[key] = value; };
export const nativeObjectSetSafe = function objectSetSafe(object: unknown, key: string, value: unknown): void {
    if (key.charCodeAt(0) === 95 && key === '__proto__') Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
    else (object as Record<string, unknown>)[key] = value;
  };
export const nativeObjectHasOwn = function objectHasOwn(object: unknown, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); };
export const nativeObjectKeys = function objectKeys(object: unknown): string[] { return Object.keys(object as object); };
export const nativeMapCreate = function mapCreate(): NativeMap { return new Map(); };
export const nativeMapHas = function mapHas(map: unknown, key: unknown): boolean { return (map as NativeMap).has(key); };
export const nativeMapGet = function mapGet(map: unknown, key: unknown): unknown { return (map as NativeMap).get(key); };
export const nativeMapSet = function mapSet(map: unknown, key: unknown, value: unknown): void { (map as NativeMap).set(key, value); };
export const nativeMapSize = function mapSize(map: unknown): number { return (map as NativeMap).size; };
export const nativeMapKeys = function mapKeys(value: unknown): unknown[] { return Array.from((value as NativeMap).keys()); };
export const nativeMapValue = function mapValue(map: unknown): unknown { return map; };
export const nativeMapFromValue = function mapFromValue(value: unknown): NativeMap { return value as NativeMap; };
export const nativeSetCreate = function setCreate(): NativeSet { return new Set(); };
export const nativeSetHas = function setHas(set: unknown, value: unknown): boolean { return (set as NativeSet).has(value); };
export const nativeSetAdd = function setAdd(set: unknown, value: unknown): void { (set as NativeSet).add(value); };
export const nativeSetValues = function setValues(value: unknown): unknown[] { return Array.from((value as NativeSet).values()); };
export const nativeSetValue = function setValue(set: unknown): unknown { return set; };
export const nativeFail = function fail(message: string): never { throw new YAMLParseError(message); };
