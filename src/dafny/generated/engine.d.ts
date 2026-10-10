export interface GeneratedEngine {
  __ctor(): void;
  Reset(text: string, isStrict: boolean, internValues: boolean, keyCacheBudget: unknown): void;
  EndStream(): void;
  ParseSingle(): unknown;
  ParseAll(): unknown;
}

export const DafnyCore: {
  Engine: new () => GeneratedEngine;
};

export const Serializer: {
  Writer: new () => {
    __ctor(): void;
    Stringify(value: unknown): string;
  };
  __default: {
    Stringify(value: unknown): string;
  };
};

export const SurfaceOptions: {
  __default: {
    SelectYamlParseOptions(secondFunction: boolean, secondTruthy: boolean, thirdUndefined: boolean): boolean;
    SelectYamlStringifyOptions(secondFunction: boolean, secondArray: boolean, secondTruthy: boolean, thirdUndefined: boolean): boolean;
    SelectJsYamlLoadAllOptions(secondObject: boolean): boolean;
    RejectYamlOptionsPrimitive(looselyNullish: boolean, objectType: boolean): boolean;
    RejectRecognizedOption(code: number, undefinedValue: boolean, truthyValue: boolean, coreSchemaIdentity: boolean, exactlyTrue: boolean, coreText: boolean, version12Text: boolean): boolean;
  };
};

export const SurfaceHelpers: {
  __default: {
    TagKindName(kind: number): string;
    ReturnSchemaIdentity(receiver: unknown): unknown;
    ReturnCapturedContents(captured: unknown): unknown;
  };
};

export const SurfaceErrors: {
  __default: {
    ParseErrorName(): string;
    NotImplementedErrorName(): string;
    YamlExceptionName(): string;
    ChooseExceptionReason(reason: unknown, nullish: boolean, fallback: unknown): unknown;
    ChooseExceptionMark(mark: unknown, nullish: boolean, freshDefault: unknown): unknown;
  };
};

export const NativeSurface: {
  Adapter: new () => {
    __ctor(): void;
    Parse(text: string, options: unknown): unknown;
    ParseAll(text: string, options: unknown): unknown;
    Stringify(value: unknown): unknown;
    ExceptionToString(receiver: unknown): unknown;
    NotImplementedMessage(functionName: unknown): unknown;
  };
};
