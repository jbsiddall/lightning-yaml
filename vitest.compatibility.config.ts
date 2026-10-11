import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/compatibility/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "test/compatibility/cst/candidate.integration.test.ts",
    ],
    fileParallelism: false,
    server: { deps: { inline: ["@fast-check/vitest"] } },
  },
});
