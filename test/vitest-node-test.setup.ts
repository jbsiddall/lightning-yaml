import { vi } from "vitest";

// Share the existing assertion bodies between node:test and the coverage run.
vi.mock("node:test", async () => {
  const { test } = await import("vitest");
  return { test };
});
