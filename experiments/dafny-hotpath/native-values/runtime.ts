export type NativeValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | NativeArray
  | NativeRecord;

export interface NativeArray extends Array<NativeValue> {}
export interface NativeRecord { [key: string]: NativeValue }
const heapBrand: unique symbol = Symbol('native-value heap');
export interface Heap { readonly [heapBrand]: true }

export function createHeap(): Heap { return { [heapBrand]: true }; }

function index(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= 2147483647) {
    throw new RangeError('Expected a bounded nonnegative integer');
  }
}

function arrayIndex(array: NativeArray, value: number): void {
  index(value);
  if (value >= array.length) throw new RangeError('Array index out of bounds');
}

export const NativeValues = Object.freeze({
  createHeap,
  nullValue: null,
  undefinedValue: undefined,
  numberFromIndex(_heap: Heap, value: number): number {
    index(value);
    return value;
  },
  parseNumber(_heap: Heap, text: string): number { return Number(text); },
  stringifyNumber(_heap: Heap, value: number): string { return String(value); },
  boolValue(_heap: Heap, value: boolean): boolean { return value; },
  stringValue(_heap: Heap, value: string): string { return value; },
  isNull(_heap: Heap, value: NativeValue): boolean { return value === null; },
  isUndefined(_heap: Heap, value: NativeValue): boolean { return value === undefined; },
  sameValue(_heap: Heap, left: NativeValue, right: NativeValue): boolean {
    return Object.is(left, right);
  },
  createArray(_heap: Heap): NativeArray { return []; },
  arrayPush(_heap: Heap, array: NativeArray, value: NativeValue): void {
    if (array.length >= 2147483646) throw new RangeError('Array length limit reached');
    array.push(value);
  },
  arrayGet(_heap: Heap, array: NativeArray, at: number): NativeValue {
    arrayIndex(array, at);
    if (!Object.prototype.hasOwnProperty.call(array, at)) {
      throw new TypeError('Sparse arrays are outside the dense-array contract');
    }
    return array[at];
  },
  arraySet(_heap: Heap, array: NativeArray, at: number, value: NativeValue): void {
    arrayIndex(array, at);
    array[at] = value;
  },
  arrayLength(_heap: Heap, array: NativeArray): number {
    index(array.length);
    return array.length;
  },
  createObject(_heap: Heap): NativeRecord { return {}; },
  objectGet(_heap: Heap, object: NativeRecord, key: string): NativeValue {
    return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
  },
  objectHasOwn(_heap: Heap, object: NativeRecord, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
  },
  objectSet(_heap: Heap, object: NativeRecord, key: string, value: NativeValue): void {
    if (key === '__proto__') {
      Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
    } else {
      object[key] = value;
    }
  },
  objectKeys(_heap: Heap, object: NativeRecord): string[] { return Object.keys(object); },
});
