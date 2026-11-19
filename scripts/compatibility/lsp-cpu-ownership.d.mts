export interface OwnershipFunction { moduleId: string; functionName: string; lineNumber: number; columnNumber: number; category?: string }
export interface OwnershipManifest {
  schema: string;
  modules: { id: string; path: string; sha256: string }[];
  functions: OwnershipFunction[];
  boundaries: { operation: OwnershipFunction; batch: OwnershipFunction };
}
export interface AttributionRow { samples: number; intervalWeightedEstimateUs: number }
export interface OwnershipAudit {
  sampleCount: number; operationSamples: number; usefulSamples: number; classifiedSamples: number;
  coverage: { numerator: number; denominator: number; ratio: number }; adequate: boolean;
  exclusive: Record<string, AttributionRow>; nearestOwned: Record<string, AttributionRow>; inclusive: Record<string, AttributionRow>;
  clock: { spanUs: number; deltaSumUs: number; trailingUnassignedUs: number };
}
export function validateOwnershipManifest(manifest: OwnershipManifest): OwnershipManifest;
export function auditOwnedCpuProfile(bytes: Buffer, expectedSha256: string, manifest: OwnershipManifest): OwnershipAudit;
