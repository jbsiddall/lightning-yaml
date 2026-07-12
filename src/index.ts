/**
 * lightning-yaml — the parser itself.
 *
 * There is no implementation yet. This module is the public surface the rest of
 * the project (benchmarks + the vitest consistency suite) already depends on, so
 * everything is wired up and ready the moment a real parser lands:
 *
 *   - `parse(text)`      text → JS value  (the counterpart of `JSON.parse`)
 *   - `stringify(value)` JS value → text  (the counterpart of `JSON.stringify`)
 *
 * Until then both throw `NotImplementedError`. The harness recognises that error
 * (see `candidateSupports` in `bench/candidates.ts`) and skips this candidate in
 * the speed/memory benchmarks; the consistency tests call these functions and
 * fail — which is the point. Each failing test is a spec of behaviour the real
 * parser must satisfy to match the oracle (see `bench/oracle.ts`).
 */

/**
 * Thrown by the not-yet-written `parse`/`stringify`. A dedicated class (rather
 * than a bare `Error`) lets the benchmark harness tell "not built yet" apart
 * from a genuine parser bug and skip the candidate instead of crashing.
 */
export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(
      `lightning-yaml ${fn}() is not implemented yet — this is the stub the ` +
        `benchmark + test harness is built against. See src/index.ts.`,
    );
    this.name = "NotImplementedError";
  }
}

/** Parse a YAML document into a JS value. Not implemented yet. */
export function parse(_text: string): unknown {
  throw new NotImplementedError("parse");
}

/** Serialize a JS value into a YAML document. Not implemented yet. */
export function stringify(_value: unknown): string {
  throw new NotImplementedError("stringify");
}
