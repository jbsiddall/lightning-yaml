export function runMeasurementPhase(options: any): any;
export function validatePhaseResult(result: any, expected: any): any;
export function createCampaignBudget(options: { startedAt: number; now: () => number; outerBudgetMs: number; innerBudgetMs: number }): {
  remainingOuterMs(): number;
  remainingInnerMs(): number;
  expired(): boolean;
};
