import { expect, test } from "vitest";
import { installedPackageVersion } from "./installedPackageVersion.js";

test("compatibility workspace resolves patched Zod 4", async () => {
  expect(await installedPackageVersion("zod")).toBe("4.6.7");
});
