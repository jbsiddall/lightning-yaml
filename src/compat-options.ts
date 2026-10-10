import { SurfaceOptions } from "./dafny/generated/engine.js";

/**
 * Shared options-dispatch scaffold for the `./yaml` and `./js-yaml` compat
 * shims. Each entry point checks own enumerable string keys in order against
 * a small allowlist. Nullish, primitive, and array bags may be ignored by the
 * shared validator, and a key whose value is `undefined` is skipped. Present
 * unsupported values normally fail through the shim's own error type. The
 * current rule-table prototype lookup has known exceptions: inherited names
 * can produce a misleading rule error or a raw TypeError. Later option
 * sub-tasks register their rules here rather than rewriting each entry point.
 */

/**
 * A rule for one option key. Given the value present in the bag, return `null`
 * when it's accepted — a genuine no-op today (e.g. the default schema) or a
 * value the shim honours — or a short reason phrase when it must be rejected,
 * read as `option "<key>" <reason>`. A later sub-task can replace a rejecting
 * rule when that option is wired up.
 */
export type OptionRule = (value: unknown) => string | null;

export const enum RecognizedRule {
  AcceptAny = 1,
  RequireCoreSchemaIdentity = 2,
  RequireExactlyTrue = 3,
  RejectEveryDefinedValue = 4,
  RejectTruthy = 5,
  RequireCoreText = 6,
  RequireVersion12Text = 7,
}

/** Apply the proved rejection decision for a recognized option rule. */
export function rejectsRecognizedOption(
  code: number,
  value: unknown,
  coreSchema?: unknown,
): boolean {
  return SurfaceOptions.__default.RejectRecognizedOption(
    code,
    value === undefined,
    !!value,
    coreSchema !== undefined && value === coreSchema,
    value === true,
    value === "core",
    value === "1.2",
  );
}
/** Rule for a known option that isn't honoured yet: rejects every defined value. */
export const notYetSupported: OptionRule = (value) =>
  rejectsRecognizedOption(RecognizedRule.RejectEveryDefinedValue, value) ? "is not supported yet" : null;

/** A recognized option that is intentionally accepted without changing behavior. */
export const acceptAny: OptionRule = (value) =>
  rejectsRecognizedOption(RecognizedRule.AcceptAny, value) ? "is not supported yet" : null;

/**
 * Rule for a boolean option whose truthy value turns on a feature the shim can't honour
 * yet, AND whose falsy value (`false`/absent) already matches what lightning-yaml produces
 * — so only a truthy value is rejected (with `clause`, read after `option "<key>"`).
 *
 * Use ONLY after confirming the falsy value is a genuine no-op against REAL output. If
 * lightning-yaml's hardcoded behaviour instead matches the option's *truthy* side (e.g. it
 * always single-quotes, so `singleQuote: false` would NOT be a no-op), this rule silently
 * emits wrong output — use `notYetSupported` there so every explicit value fails loud.
 */
export const activatesFeature = (clause: string): OptionRule => (value) =>
  rejectsRecognizedOption(RecognizedRule.RejectTruthy, value) ? clause : null;

/**
 * Validate an option bag against `rules`, calling `fail` (which must throw) on
 * the first unsupported key or value. A key explicitly set to `undefined` is
 * treated as absent, matching how the real libraries ignore an omitted option.
 * A non-plain-object bag (a bare scalar or array) is treated as no options — the
 * real libraries ignore it too.
 */
export function validateOptions(
  opts: object | null | undefined,
  rules: Record<string, OptionRule>,
  fail: (message: string) => never,
): void {
  if (opts == null) return;
  // Treat it as no options rather than enumerating a scalar's or array's indices as bogus keys. The
  // one place a scalar IS meaningful — a number/string as `yaml.stringify`'s indent shorthand — is
  // rejected at that call site (src/yaml-compat.ts), before this helper runs.
  if (typeof opts !== "object" || Array.isArray(opts)) return;
  const bag = opts as Record<string, unknown>;
  for (const key of Object.keys(bag)) {
    const value = bag[key];
    if (value === undefined) continue;
    const rule = rules[key] as OptionRule | undefined;
    if (!rule) fail(`option "${key}" is not supported`);
    const reason = rule(value);
    if (reason !== null) fail(`option "${key}" ${reason}`);
  }
}
