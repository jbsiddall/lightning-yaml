export const CPU_PROTOCOL: Readonly<{ externalGuardMs: number }>;
export interface ScheduleRow { fixture: string; repeat: number; id: string }
export interface LedgerRow extends ScheduleRow {
  state: string; completedOperations: number; timeout: boolean; signal: string | null;
  cleanup: string; receiptSha256: string | null; artifactSha256: string | null;
}
export interface CampaignReport { status: string; firstFailure: { id: string; reason: string } | null; ledger: LedgerRow[] }
export function referenceCpuSchedule(): ScheduleRow[];
export function runReferenceCpuCampaign(options: {
  plan: { sha256: string };
  startedAt: number;
  now: () => number;
  launch: (row: LedgerRow, timeout: number) => { status: number | null; signal: string | null; error?: { code: string; message: string } };
  validate: () => { completedOperations: number; receiptSha256: string; artifactSha256: string; cleanup: string; adequate: boolean };
  persist: (report: CampaignReport) => void;
  prepare?: () => void;
}): Promise<CampaignReport>;
