/** The page-side hook contract — installed by pageHarness.ts, driven by memoryRun.ts; declared once so the two can't drift. */
export interface MemoryPageHooks {
  __memParseAndRetain?: (url: string, category: string, iters: number) => Promise<void>;
  __memDropRetained?: () => number;
  __memReadHeap?: () => Promise<number>;
}
