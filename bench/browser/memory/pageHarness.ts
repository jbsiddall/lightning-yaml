/**
 * Page-side hooks the Node driver (bench/browser/memoryRun.ts) calls via
 * `page.evaluate()` — one bundle per library (see entries/*.ts), so
 * parsing a fixture never pulls a competing library's code/allocations into
 * the same page. Deliberately thin: all measurement (gc()+heap-delta for
 * Chromium, /proc peak-RSS for webkit) happens on the Node side, driven
 * explicitly, rather than the page self-driving and signalling completion —
 * that keeps this file symmetric across both engines (webkit has no
 * `performance.memory` to read from in-page at all) and keeps the
 * batch-retained-then-drop lifecycle explicit at the call site instead of
 * implicit in page-side control flow.
 */

declare global {
  interface Window {
    __memParseAndRetain?: (url: string, category: string, iters: number) => Promise<number>;
    __memDropRetained?: () => number;
    __memReadHeap?: () => Promise<number>;
  }
}

/**
 * Installs the three hooks the driver calls. `parseFn` is the one thing that
 * differs per library — each entries/*.ts file supplies its own, statically
 * imported so esbuild bundles exactly (and only) that library's code.
 */
export function installMemoryHarness(parseFn: (text: string, category: string) => unknown): void {
  let retained: unknown[] | null = null;

  window.__memParseAndRetain = async (url: string, category: string, iters: number): Promise<number> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fixture fetch failed: ${url} (HTTP ${res.status})`);
    const text = await res.text();

    const arr: unknown[] = new Array(iters);
    for (let i = 0; i < iters; i++) arr[i] = parseFn(text, category);
    retained = arr; // kept referenced until __memDropRetained() — this IS the measured allocation.
    return arr.length;
  };

  // Returns the count it dropped so the driver can assert the batch actually
  // survived until the "after" reading — a silent page reload or renderer
  // crash mid-batch would zero it (and invalidate the measurement with it).
  window.__memDropRetained = (): number => {
    const dropped = retained?.length ?? 0;
    retained = null;
    return dropped;
  };

  // Chromium-only (performance.memory doesn't exist in webkit); the webkit
  // leg never calls this and measures via /proc instead (see proc.ts). Runs
  // gc() itself (the `--js-flags=--expose-gc` global) so every reading is
  // post-collection without a separate round trip that could reintroduce a
  // timing gap between "collect" and "read". Collects TWICE with a macrotask
  // gap between: a single gc() call reliably reclaims the immediately-dead
  // array (the point of this harness), but a prior fixture's large retained
  // batch can leave sweeping/finalization work still in flight — verified
  // against a real run, where a single-gc() reading after a ~60 MB fixture
  // occasionally left the NEXT (much smaller) fixture's "before" reading
  // elevated enough to swing its net delta negative. The gap gives that
  // leftover work a turn of the event loop to finish before the second
  // collection, which is the one actually read.
  window.__memReadHeap = async (): Promise<number> => {
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
