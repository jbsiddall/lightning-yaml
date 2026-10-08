import { strictEqual, throws } from "node:assert";
import { test } from "node:test";
import { runWorker } from "../bench/memory/run.ts";

test("a worker spawn error aborts with the original error", () => {
  const spawnError = Object.assign(new Error("spawnSync node EPERM"), { code: "EPERM" });

  throws(
    () => runWorker("lightning-yaml", "small-records", "parse", () => ({
      error: spawnError,
      status: null,
      stderr: null,
      stdout: null,
    })),
    (error) => error === spawnError,
  );
});

test("a worker that starts and exits unsuccessfully remains a worker failure", () => {
  strictEqual(
    runWorker("lightning-yaml", "small-records", "parse", () => ({
      status: 1,
      stderr: "worker failed",
      stdout: "",
    })),
    null,
  );
});
