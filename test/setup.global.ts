/**
 * Vitest global setup — runs once before the suite. Fixtures are generated and
 * gitignored, so ensure they exist (generating only the missing ones) so a fresh
 * checkout can `pnpm test` without a separate `pnpm gen:fixtures` step.
 *
 * NOTE: "only the missing ones" means existing fixtures are NOT refreshed. After
 * editing the generator or dataset definitions (`bench/fixtures/*.ts`), run
 * `pnpm gen:fixtures` to regenerate all fixtures before `pnpm test`, or you'll
 * test against stale data. Fresh checkouts / CI are unaffected (no files yet).
 */

import { ensureFixtures } from "../bench/fixtures/generate.ts";

export default function setup(): void {
  ensureFixtures();
}
