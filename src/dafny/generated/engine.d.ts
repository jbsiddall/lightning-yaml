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
