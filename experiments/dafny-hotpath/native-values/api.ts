import { createHeap } from './runtime';
import type { Heap } from './runtime';

export interface DemoChild {
  number: number;
  text: string;
  boolean: boolean;
}

export interface Demo {
  child: DemoChild;
  list: [DemoChild, DemoChild];
  null: null;
  undefined: undefined;
  self: Demo;
}

interface Kernel {
  Demo(heap: Heap): unknown;
  BuildNumbers(heap: Heap, count: number): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKernel(value: unknown): value is Kernel {
  if (!hasProperties(value)) return false;
  return typeof value['Demo'] === 'function' && typeof value['BuildNumbers'] === 'function';
}

function hasProperties(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isUnknownArray(value: unknown): value is unknown[] { return Array.isArray(value); }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasDataProperties(object: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => {
    const property = Object.getOwnPropertyDescriptor(object, key);
    return property !== undefined && 'value' in property && property.enumerable === true;
  });
}

function isChild(value: unknown): value is DemoChild {
  return isPlainRecord(value) && hasDataProperties(value, ['number', 'text', 'boolean']) &&
    typeof value['number'] === 'number' && typeof value['text'] === 'string' && typeof value['boolean'] === 'boolean';
}

function isDemo(value: unknown): value is Demo {
  if (!isPlainRecord(value) || !hasDataProperties(value, ['child', 'list', 'null', 'undefined', 'self'])) return false;
  const child = value['child'];
  const list: unknown = value['list'];
  return isChild(child) && isUnknownArray(list) && Object.getPrototypeOf(list) === Array.prototype &&
    list.length === 2 && Object.prototype.hasOwnProperty.call(list, 0) && Object.prototype.hasOwnProperty.call(list, 1) &&
    list[0] === child && list[1] === child && value['null'] === null && value['undefined'] === undefined &&
    value['self'] === value;
}

function isNumbers(value: unknown): value is number[] {
  if (!isUnknownArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  for (let i = 0; i < value.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(value, i) || typeof value[i] !== 'number') return false;
  }
  return true;
}

export interface NativeApi {
  demo(): Demo;
  numbers(count: number): number[];
}

export function createNativeApi(candidate: unknown): NativeApi {
  if (!isKernel(candidate)) throw new TypeError('Native Dafny kernel is missing Demo or BuildNumbers');
  const kernel = candidate;
  return {
    demo(): Demo {
      const value = kernel.Demo(createHeap());
      if (!isDemo(value)) throw new TypeError('Generated Demo violated the native ABI');
      return value;
    },
    numbers(count: number): number[] {
      if (!Number.isInteger(count) || count < 0 || count >= 2147483647) {
        throw new RangeError('Expected a bounded nonnegative integer count');
      }
      const value = kernel.BuildNumbers(createHeap(), count);
      if (!isNumbers(value) || value.length !== count) throw new TypeError('Generated BuildNumbers violated the native ABI');
      return value;
    },
  };
}
