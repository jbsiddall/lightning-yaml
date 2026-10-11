export type Operation =
  | "parse"
  | "parseDocument"
  | "parseAllDocuments"
  | "stringify";
export interface OptionRecipe {
  values: Record<string, unknown>;
  undefinedKeys?: string[];
  callback?: string;
  schema?: string;
}
export interface CaseDescriptor {
  id: string;
  operation: Operation;
  text?: string;
  graph?: string;
  valueRecipe?: string;
  options: OptionRecipe;
  call?: string;
  conversionOptions?: OptionRecipe;
  source: string;
  categories: string[];
  seed?: number;
}
export interface ErrorRecord {
  name: string;
  message: string;
  code?: string;
  position?: number;
  linePos?: unknown;
}
export interface Outcome {
  status: "success" | "error";
  value?: unknown;
  text?: unknown;
  docs?: unknown[];
  stream?: unknown;
  trace: unknown[];
  warnings?: unknown[];
  error?: ErrorRecord;
}
export interface Difference {
  category: string;
  path?: string;
  reason?: string;
}
export interface CaseResult {
  descriptor: CaseDescriptor;
  reference: Outcome;
  candidate: Outcome;
  differences: Difference[];
  semantic?: {
    referenceAvailable: boolean;
    candidateAvailable?: boolean;
    equal?: boolean;
    reason?: string;
    path?: string;
  };
  documentSurface?: {
    reference?: unknown;
    candidate?: unknown;
    equal?: boolean;
    streamMetadataEqual?: boolean;
    reason?: string;
  };
}
