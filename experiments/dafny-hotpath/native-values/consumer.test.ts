import { createNativeApi } from './dist/api';
import type { Demo, DemoChild } from './dist/api';
import { NativeValues, createHeap } from './dist/runtime';
import type { NativeArray, NativeRecord, NativeValue } from './dist/runtime';

const api = createNativeApi({ Demo: () => undefined, BuildNumbers: () => undefined });
const demo: Demo = api.demo();
const child: DemoChild = demo.list[0];
const nil: null = demo.null;
const absent: undefined = demo.undefined;
const numbers: number[] = api.numbers(10);
const numberOrMissing: number | undefined = numbers[0];
const heap = createHeap();
const array: NativeArray = NativeValues.createArray(heap);
const object: NativeRecord = NativeValues.createObject(heap);
const value: NativeValue = NativeValues.arrayGet(heap, array, 0);
NativeValues.objectSet(heap, object, 'child', array);
const recursive: NativeValue = { child: [null, undefined, object] };
void [child, nil, absent, numberOrMissing, value, recursive];

// @ts-expect-error Input is a bounded number, not arbitrary text.
api.numbers('10');
// @ts-expect-error null and undefined are different public fields.
const wrongNull: null = demo.undefined;
// @ts-expect-error Native values do not include callable objects.
NativeValues.arrayPush(heap, array, () => true);
// @ts-expect-error Heap contexts cannot be replaced by arbitrary object/primitive values.
NativeValues.createArray(5);
// @ts-expect-error No unconstrained generic parse-like result cast.
api.numbers<string>(10);
// @ts-expect-error Indexed arrays retain possible absence under strict consumer settings.
const uncheckedNumber: number = numbers[0];
void [wrongNull, uncheckedNumber];
