export function censusOwnGraph(roots: Array<{ name: string; value: unknown }>, options?: {
  classify?: (value: object) => string;
  stringFields?: string[];
}): {
  objects: number;
  arrays: number;
  strings: number;
  stringCodeUnits: number;
  uniqueReferences: number;
  categories: Record<string, number>;
  roots: Array<{ name: string; kind: string }>;
};
export function validateDiagnosticRequest(options: {
  diagnostic: 'cpu-profile' | 'graph-census' | 'heap-snapshot';
  participant: 'candidate' | 'reference' | 'server-candidate' | 'server-reference';
  fixture: string;
  policy?: 'literal-default' | 'uniqueKeys-false' | 'uniqueKeys-true';
  artifact?: string;
}): { serverMode: boolean; policy: string; provider: 'candidate' | 'reference' };
export function classifyCpuSamples(profile: { nodes: Array<{ id: number; children?: number[]; callFrame?: { functionName?: string; url?: string } }>; samples?: number[] }): {
  sampleCount: number;
  categories: Record<'lexerParser' | 'composition' | 'customCallbacks' | 'runtimeGc' | 'serverAst' | 'unassigned', number>;
  attributionAssessment: 'insufficient-samples-for-fine-attribution' | 'sample-count-threshold-met';
};
export function collectCpuProfile(options: {
  session?: any;
  operation: () => unknown;
  warmups?: number;
  iterations?: number;
  sampleIntervalUs?: number;
}): Promise<{ warmups: number; iterations: number; sampleIntervalUs: number; profile: any }>;
export function writeHeapSnapshot(filePath: string, options?: { session?: any }): Promise<{ bytes: number; chunks: number }>;
