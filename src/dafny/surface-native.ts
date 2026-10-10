/**
 * Atomic host operations used by the Dafny public-surface adapters.
 *
 * These functions preserve JavaScript operation order and raw thrown values;
 * they do not choose YAML or compatibility policy. The Dafny caller inspects
 * the tagged completion and decides whether to return, propagate, or translate
 * the captured value.
 */

export type SurfaceCompletion =
  | { readonly kind: 0; readonly value: unknown }
  | { readonly kind: 1; readonly value: unknown };

const returnedUndefined: SurfaceCompletion = { kind: 0, value: undefined };
const completed = (kind: 0 | 1, value: unknown): SurfaceCompletion =>
  kind === 0 && value === undefined ? returnedUndefined : { kind, value };

export const surfaceReturned = (value: unknown): SurfaceCompletion => completed(0, value);
export const surfaceThrown = (value: unknown): SurfaceCompletion => completed(1, value);
export const surfaceCompletionIsThrown = (completion: SurfaceCompletion): boolean => completion.kind === 1;
export const surfaceCompletionValue = (completion: SurfaceCompletion): unknown => completion.value;
export const surfaceIsNullish = (value: unknown): boolean => value === undefined || value === null;
export const surfaceIsTruthy = (value: unknown): boolean => !!value;
export const surfaceIsExactlyTrue = (value: unknown): boolean => value === true;
export const surfaceIsString = (value: unknown): boolean => typeof value === 'string';

export const surfaceTemplateString = (value: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned(`${value}`);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};
export const surfaceReturnedString = (value: string): SurfaceCompletion => surfaceReturned(value);

export const surfaceCaptureNormalizationRecord = (
  strict: boolean,
  intern: boolean,
  budget: unknown,
): SurfaceCompletion => {
  try {
    return surfaceReturned({ strict, intern, budget });
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceNormalizationStrict = (record: unknown): boolean =>
  (record as { strict: boolean }).strict;
export const surfaceNormalizationIntern = (record: unknown): boolean =>
  (record as { intern: boolean }).intern;
export const surfaceNormalizationBudget = (record: unknown): unknown =>
  (record as { budget: unknown }).budget;

export const surfaceCaptureTypeError = (message: string): SurfaceCompletion => {
  try {
    return surfaceThrown(new TypeError(message));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

const intrinsicApply = Reflect.apply;

export const surfaceReadProperty = (target: unknown, key: PropertyKey): SurfaceCompletion => {
  try {
    return surfaceReturned((target as Record<PropertyKey, unknown>)[key]);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceReadArrayLength = (array: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned((array as { length: number }).length);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceReadArrayIndex = (array: unknown, index: number): SurfaceCompletion => {
  try {
    return surfaceReturned((array as Record<number, unknown>)[index]);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceOwnEnumerableStringKeys = (value: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned(Object.keys(value as object));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceGetOwnPropertyDescriptor = (target: unknown, key: PropertyKey): SurfaceCompletion => {
  try {
    return surfaceReturned(Object.getOwnPropertyDescriptor(target as object, key));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceSetProperty = (target: unknown, key: PropertyKey, value: unknown): SurfaceCompletion => {
  try {
    (target as Record<PropertyKey, unknown>)[key] = value;
    return surfaceReturned(undefined);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceDeleteProperty = (target: unknown, key: PropertyKey): SurfaceCompletion => {
  try {
    const deleted = delete (target as Record<PropertyKey, unknown>)[key];
    return surfaceReturned(deleted);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceDefineOwnProperty = (
  target: unknown,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): SurfaceCompletion => {
  try {
    return surfaceReturned(Object.defineProperty(target as object, key, descriptor));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceApply = (fn: unknown, thisArg: unknown, args: unknown[]): SurfaceCompletion => {
  try {
    return surfaceReturned(intrinsicApply(fn as (...args: never[]) => unknown, thisArg, args));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceMultiplyByNumber = (value: unknown, multiplier: number): SurfaceCompletion => {
  try {
    return surfaceReturned((value as number) * multiplier);
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceStringConvert = (value: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned(String(value));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceNumberConvert = (value: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned(Number(value));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceIsArray = (value: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned(Array.isArray(value));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceInstanceOf = (value: unknown, constructor: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned(value instanceof (constructor as Function));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceCreateArray = (): SurfaceCompletion => surfaceReturned([]);
export const surfaceCreateObject = (): SurfaceCompletion => surfaceReturned({});

export const surfaceCreateError = (message: string): SurfaceCompletion => {
  try {
    return surfaceReturned(new Error(message));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceCreateDocument = (
  contents: unknown,
  errors: Error[],
  warnings: Error[],
  toJS: () => unknown,
  toJSON: () => unknown,
): object => ({ contents, errors, warnings, toJS, toJSON });

export const surfaceCaptureEngineReset = (
  engine: unknown,
  text: string,
  strict: boolean,
  internValues: boolean,
  keyCacheBudget: unknown,
): SurfaceCompletion => {
  try {
    (engine as { Reset: (text: string, strict: boolean, intern: boolean, budget: unknown) => void })
      .Reset(text, strict, internValues, keyCacheBudget);
    return returnedUndefined;
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceCaptureEngineParseSingle = (engine: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned((engine as { ParseSingle: () => unknown }).ParseSingle());
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceCaptureEngineParseAll = (engine: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned((engine as { ParseAll: () => unknown }).ParseAll());
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceCaptureEngineEndStream = (engine: unknown): SurfaceCompletion => {
  try {
    (engine as { EndStream: () => void }).EndStream();
    return returnedUndefined;
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};

export const surfaceCaptureWriterStringify = (writer: unknown, value: unknown): SurfaceCompletion => {
  try {
    return surfaceReturned((writer as { Stringify: (value: unknown) => unknown }).Stringify(value));
  } catch (thrown) {
    return surfaceThrown(thrown);
  }
};
