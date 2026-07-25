/** Page-side hooks the driver (bench/browser/memoryRun.ts) calls; one bundle per library, so a page only holds what it measures. */

declare global {
  interface Window {
    __memParseAndRetain?: (url: string, category: string, iters: number) => Promise<void>;
    __memDropRetained?: () => number;
    __memReadHeap?: () => Promise<number>;
  }
}

/** `parseFn` is the one thing that differs per library — each entries/*.ts supplies its own. */
export function installMemoryHarness(parseFn: (text: string, category: string) => unknown): void {
  let retained: unknown[] | null = null;

  window.__memParseAndRetain = async (url, category, iters) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fixture fetch failed: ${url} (HTTP ${res.status})`);
    const text = await res.text();

    const arr: unknown[] = new Array(iters);
    for (let i = 0; i < iters; i++) arr[i] = parseFn(text, category);
    retained = arr; // holding these IS the allocation being measured
  };

  // The driver checks this count against K to catch a page that reloaded or crashed mid-batch.
  window.__memDropRetained = () => {
    const dropped = retained?.length ?? 0;
    retained = null;
    return dropped;
  };

  // Chromium only — webkit has no performance.memory and measures via /proc. See memoryRun.ts for why two gc() passes.
  window.__memReadHeap = async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) throw new Error("gc() unavailable — launch chromium with --js-flags=--expose-gc");
    gc();
    await new Promise((r) => setTimeout(r, 30));
    gc();
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (!mem) throw new Error("performance.memory unavailable — launch chromium with --enable-precise-memory-info");
    return mem.usedJSHeapSize;
  };
}
