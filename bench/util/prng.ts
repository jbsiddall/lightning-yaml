/**
 * Deterministic, seedable PRNG so generated fixtures are byte-for-byte
 * reproducible across machines and runs. mulberry32 — small, fast, good enough
 * for test data (not cryptographic).
 */

const WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
  "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "xray",
  "yankee", "zulu", "lightning", "parser", "benchmark", "throughput", "latency",
];

// A few non-ASCII characters so string-heavy fixtures exercise UTF-8 handling.
const UNICODE = ["é", "ñ", "ü", "λ", "π", "→", "★", "日", "本", "🚀"];

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  bool(): boolean;
  pick<T>(items: readonly T[]): T;
  /** Human-ish string of roughly `words` space-joined tokens. */
  words(count: number): string;
  /** String of `len` characters, occasionally including unicode. */
  chars(len: number): string;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];

  return {
    next,
    int,
    float: (min, max) => min + next() * (max - min),
    bool: () => next() < 0.5,
    pick,
    words: (count) => Array.from({ length: count }, () => pick(WORDS)).join(" "),
    chars: (len) => {
      let out = "";
      while (out.length < len) {
        out += next() < 0.05 ? pick(UNICODE) : pick(WORDS) + " ";
      }
      return out.slice(0, len);
    },
  };
}
