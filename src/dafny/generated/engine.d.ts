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
