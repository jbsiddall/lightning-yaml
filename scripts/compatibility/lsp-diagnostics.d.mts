export function censusOwnGraph(roots: Array<{ name: string; value: unknown }>, options?: {
  classify?: (value: object) => string;
  stringFields?: string[];
  excludedReferenceFields?: string[];
}): {
  objects: number;
  arrays: number;
  stringFieldOccurrences: number;
  stringFieldCodeUnits: number;
  uniqueReferences: number;
  categories: Record<string, number>;
  roots: Array<{ name: string; kind: string; referenceId?: string }>;
  excludedReferences: Record<string, {
    occurrences: number;
    uniqueReferences: number;
    identities: Array<{ id: string; occurrences: number }>;
    links: Array<{ ownerReferenceId: string; ownerCategory: string; referencedIdentityId: string }>;
  }>;
};
export function validateDiagnosticRequest(options: {
  diagnostic: 'cpu-profile' | 'graph-census' | 'heap-snapshot';
  participant: 'candidate' | 'reference' | 'server-candidate' | 'server-reference';
  fixture: string;
  policy?: 'literal-default' | 'uniqueKeys-false' | 'uniqueKeys-true';
  artifact?: string;
}): { serverMode: boolean; policy: string; provider: 'candidate' | 'reference' };
export function createDiagnosticBudget(options: {
  startedAt: number;
  now: () => number;
  outerBudgetMs?: number;
  innerBudgetMs?: number;
}): {
  startInner(): number;
  remainingOuterMs(): number;
  remainingInnerMs(): number;
  remainingWorkerMs(): number;
  expired(): boolean;
};
export function validateDiagnosticWorker(result: any, expected: any): {
  resolutionCount: number;
  targetsValidated: boolean;
  parentRootsValidated: boolean;
};
export function classifyCpuSamples(profile: { nodes: Array<{ id: number; children?: number[]; callFrame?: { functionName?: string; url?: string } }>; samples?: number[] }): {
  sampleCount: number;
  categories: Record<'lexerParser' | 'composition' | 'customCallbacks' | 'runtimeGc' | 'serverAst' | 'serverWrapper' | 'unassigned', number>;
  assignedSamples: number;
  usefulSamples: number;
  classifiedCoverage: number;
  attributionAssessment: 'insufficient-samples-or-coverage-for-fine-attribution' | 'sample-count-and-coverage-threshold-met';
};
export function collectCpuProfile(options: {
  session?: any;
  operation: () => unknown;
  warmups?: number;
  iterations?: number;
  sampleIntervalUs?: number;
}): Promise<{ warmups: number; iterations: number; sampleIntervalUs: number; profile: any }>;
export function writeHeapSnapshot(filePath: string, options?: {
  session?: any;
  createSink?: (filePath: string) => {
    write(chunk: string): boolean | void;
    close(): void | Promise<void>;
    abort(): 'removed' | 'retained' | 'unknown' | void | Promise<'removed' | 'retained' | 'unknown' | void>;
  };
}): Promise<{ bytes: number; chunks: number }>;
export function createFileSink(filePath: string, options?: {
  unlink?: (path: string) => void;
  stat?: (path: string) => unknown;
}): {
  write(chunk: string): boolean;
  close(): Promise<void>;
  abort(): Promise<'removed' | 'retained' | 'unknown'>;
};
export function redactPrivatePaths(value: any): any;
