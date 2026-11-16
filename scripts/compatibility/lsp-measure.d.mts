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
export function runMeasurementPhase(options: any): any;
export function validatePhaseResult(result: any, expected: any): any;
export function createCampaignBudget(options: { startedAt: number; now: () => number; outerBudgetMs: number }): {
  remainingOuterMs(): number;
  expired(): boolean;
};
