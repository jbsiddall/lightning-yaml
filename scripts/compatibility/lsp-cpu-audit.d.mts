export interface FrameWitness { functionName: string; file: string; line: number; column: number }
export interface Witness { label: string; frames: FrameWitness[] }
export interface WitnessCounts { samples: number; intervalProxyUs: number; legacyCategories: Record<string, number> }
export interface CpuAudit {
  schema: string; artifactSha256: string; sampleCount: number; nodeHitCountSum: number;
  clock: { spanUs: number; deltaSumUs: number; firstObservationDeltaUs: number; subsequentDeltaSumUs: number;
    trailingUnassignedUs: number; minDeltaUs: number; maxDeltaUs: number };
  legacy: ReturnType<typeof import('./lsp-diagnostics.mjs').classifyCpuSamples>;
  firstObservationStack: FrameWitness[];
  witnesses: (Witness & { leaf: WitnessCounts; ancestry: WitnessCounts })[];
}
export function sha256(bytes: string | Uint8Array): string;
export function readHashBoundJson(bytes: Buffer, expectedSha256: string): any;
export function normalizedFrame(frame: { functionName: string; url: string; lineNumber: number; columnNumber: number }): FrameWitness;
export function auditCpuProfile(bytes: Buffer, expectedSha256: string, witnesses?: Witness[]): CpuAudit;
