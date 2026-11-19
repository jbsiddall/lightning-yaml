export interface InspectorSession {
  connect(): void;
  disconnect(): void;
  post(method: string, params: object, callback: (error: Error | null, result: { profile?: { startTime: number; endTime: number } }) => void): void;
}
export function collectReferenceCpu(options: {
  operation: () => unknown;
  session?: InspectorSession;
  hrtime?: () => bigint;
  cpuUsage?: () => { user: number; system: number };
}): Promise<{
  profile: { startTime: number; endTime: number };
  result: unknown;
  completedOperations: number;
  operationError: { name: string; message: string } | null;
  clocks: {
    valid: boolean; failure: string | null;
    loopWallNs: string; processUserUs: number | string; processSystemUs: number | string;
    snapshots: { wallStartNs: string; wallEndNs: string; cpuStart: { user: number | string; system: number | string }; cpuEnd: { user: number | string; system: number | string } };
  };
}>;
