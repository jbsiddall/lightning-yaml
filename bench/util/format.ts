/** Small formatting helpers for the memory-harness table. */

export function formatBytes(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (abs >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (abs >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

/** Ratio of `value` to `base`, e.g. "2.13x". Returns "—" when base is 0. */
export function ratio(value: number, base: number): string {
  if (!base) return "—";
  return `${(value / base).toFixed(2)}x`;
}

export function padEnd(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function padStart(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}
