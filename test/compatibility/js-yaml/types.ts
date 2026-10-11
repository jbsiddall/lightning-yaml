export type Operation =
  | "load"
  | "loadAll-array"
  | "loadAll-null-third"
  | "loadAll-iterator-third"
  | "loadAll-iterator-throw"
  | "loadAll-overriding"
  | "dump";
export type SchemaRecipe =
  | "default"
  | "failsafe"
  | "json"
  | "core"
  | "yaml11"
  | "custom-scalar";
export interface OptionRecipe {
  values: Record<string, unknown>;
  undefinedKeys?: string[];
  schema?: SchemaRecipe;
  callback?: "identity" | "mutate" | "throw" | "sort-asc" | "sort-desc";
  legacy?: boolean;
}
export interface CaseDescriptor {
  id: string;
  operation: Operation;
  text?: string;
  graph?: string;
  valueRecipe?: string;
  options: OptionRecipe;
  source: string;
  categories: string[];
  seed?: number;
}
export interface ErrorRecord {
  name: string;
  message: string;
  reason?: string;
  mark?: unknown;
}
export interface Outcome {
  status: "success" | "error";
  value?: unknown;
  text?: string;
  docs?: unknown[];
  trace: unknown[];
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
    reference?: unknown;
    candidate?: unknown;
    equal?: boolean;
    reason?: string;
    path?: string;
    referenceAvailable?: boolean;
    candidateAvailable?: boolean;
  };
}
