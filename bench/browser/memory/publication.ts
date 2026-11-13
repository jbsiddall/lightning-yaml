const SMALL_WORKLOADS = new Set(['yaml-plain-small-records', 'yaml-rich-small']);

type BrowserMemoryRun = { method: string; env: { runtime: string }; workloads: { workload: string }[] };

/** Exclude WebKit rows dominated by fixed page-process costs from every display. */
export function publishableMemoryRatios<T extends BrowserMemoryRun>(runs: readonly T[]): T[] {
  return runs.map((doc) => {
    if (doc.method !== 'peak-rss' || doc.env.runtime.trim().split(/\s+/)[0]?.toLowerCase() !== 'webkit') return doc;
    return { ...doc, workloads: doc.workloads.filter((row) => !SMALL_WORKLOADS.has(row.workload)) };
  });
}
