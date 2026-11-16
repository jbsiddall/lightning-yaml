export function verifyInputBytes(bytes: Buffer, expectedInputSha256: string): { inputSha256: string; source: string };
export function snapshotPublicValue(value: unknown): unknown;
export function semanticOutcomesEqual(left: any, right: any): boolean;
export function evaluateSemanticPair(policy: string, candidate: any, reference: any): {
  semanticAgreement: boolean | null;
  performanceEligible: boolean;
  reason: string | null;
};
export function isMatchedPolicySemanticMismatch(policy: string, eligibility: { semanticAgreement: boolean | null }): boolean;
export function expectedPhaseCounts(phase: string, warmups: number, iterations: number): {
  warmups: number;
  iterations: number;
  resultCount: number;
};
export function createPairedSchedule(cells: Array<{ id: string }>, options: {
  repeatCount: number;
  participants: string[];
  phases: string[];
}): Array<{ cellId: string; repeatIndex: number; participant: string; phase: string; observationId: string }>;
export function selectPairedSchedule(plannedSchedule: any[], selectedCellIds: string[]): any[];
export function finalizeScheduleLedger(plannedSchedule: any[], selectedSchedule: any[], completedIds?: string[], failedIds?: string[]): {
  planned: string[];
  selected: string[];
  completed: string[];
  failed: string[];
  pending: string[];
  notSelected: string[];
};
export function finalizeMeasurementReport(options: any): any;
export function runMeasurementPhase(options: any): any;
export function validatePhaseResult(result: any, expected: any): any;
export function createCampaignBudget(options: { startedAt: number; now: () => number; outerBudgetMs: number }): {
  remainingOuterMs(): number;
  expired(): boolean;
};
