/**
 * Shared options-dispatch scaffold for the `./yaml` and `./js-yaml` compat
 * shims. Each entry point validates its option bag against a small allowlist of
 * rules and throws — via the shim's own error type — on any key or value not
 * yet honoured, so an unsupported option always FAILS LOUD instead of silently
 * diverging from the real library. Later option sub-tasks register a rule for
 * their key in the shim's registry rather than rewriting the (tiny) entry-point
 * bodies, so "unsupported" always means "throws," never "silently ignored."
 */

/**
 * A rule for one option key. Given the value present in the bag, return `null`
 * when it's accepted — a genuine no-op today (e.g. the default schema) or a
 * value the shim honours — or a short reason phrase when it must be rejected,
 * read as `option "<key>" <reason>`. A later sub-task swaps a rejecting rule
 * for one that returns `null` once the option is actually wired up.
 */
export type OptionRule = (value: unknown) => string | null;

/** Rule for a known option that isn't honoured yet: rejects every value. */
export const notYetSupported: OptionRule = () => "is not supported yet";

/**
 * Validate an option bag against `rules`, calling `fail` (which must throw) on
 * the first unsupported key or value. A key explicitly set to `undefined` is
 * treated as absent, matching how the real libraries ignore an omitted option.
 */
export function validateOptions(
  opts: object | null | undefined,
  rules: Record<string, OptionRule>,
  fail: (message: string) => never,
): void {
  if (opts == null) return;
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
