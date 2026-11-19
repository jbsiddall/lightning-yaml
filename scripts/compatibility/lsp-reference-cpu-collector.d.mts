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
  result: unknown;
  completedOperations: number;
  operationError: { name: string; message: string } | null;
  clocks: { loopWallNs: string; processUserUs: number; processSystemUs: number };
}>;
