import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Generate any missing fixtures before the suite runs, so `pnpm test` works
    // on a fresh checkout (fixtures are gitignored).
    globalSetup: ["./test/setup.global.ts"],
    // Run test files one at a time. Mirrors the benchmark harness's "one heavy
    // parse at a time" rule: parsing the large (~1 MB) YAML fixtures with the
    // oracle is memory-hungry, and co-running files would contend for RAM.
    fileParallelism: false,
  },
});
