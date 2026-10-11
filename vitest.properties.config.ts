import { defineConfig, mergeConfig } from "vitest/config";
import existingConfig from "./vitest.config.ts";

export default mergeConfig(
  existingConfig,
  defineConfig({
    resolve: { dedupe: ["vitest", "@vitest/runner", "@vitest/expect"] },
    test: {
      include: [
        "test/**/*.test.ts",
        "test/**/*.unit.ts",
        "experiments/js-yaml-properties/**/*.test.ts",
      ],
      setupFiles: ["./test/vitest-node-test.setup.ts"],
      server: { deps: { inline: ["@fast-check/vitest"] } },
      reporters: ["default", "html", "junit"],
      outputFile: {
        html: "results/js-yaml-properties/vitest/index.html",
        junit: "results/js-yaml-properties/vitest/junit.xml",
      },
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        exclude: ["**/.scratch/**", "**/*.d.ts"],
        reporter: ["text", "html", "json-summary", "lcov"],
        reportsDirectory: "results/js-yaml-properties/coverage",
        reportOnFailure: true,
      },
    },
  }),
);
