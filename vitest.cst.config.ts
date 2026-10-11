import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/compatibility/cst/candidate.integration.test.ts"],
    exclude: configDefaults.exclude,
    fileParallelism: false,
    server: { deps: { inline: ["@fast-check/vitest"] } },
  },
});
