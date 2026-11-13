import { readFileSync } from "node:fs";
import { launchEngine, launchEngineWithProcess, type EngineName } from "./engines.ts";

const engines: EngineName[] = ["chromium", "webkit"];
const chromiumMemoryArgs = ["--enable-precise-memory-info", "--js-flags=--expose-gc"];

for (const engine of engines) {
  const normal = await launchEngine(engine);
  try {
    const page = await normal.browser.newPage();
    const result = await page.evaluate(() => 6 * 7);
    if (result !== 42) throw new Error(`${engine} normal launch returned ${result}, expected 42`);
    console.log(`${engine} normal launch: ${normal.browser.version()}`);
  } finally {
    await normal.browser.close();
  }

  const withProcess = await launchEngineWithProcess(engine, engine === "chromium" ? chromiumMemoryArgs : []);
  try {
    if (!Number.isInteger(withProcess.pid) || withProcess.pid <= 0) {
      throw new Error(`${engine} process launch returned invalid pid ${withProcess.pid}`);
    }
    readFileSync(`/proc/${withProcess.pid}/stat`, "utf8");
    const page = await withProcess.browser.newPage();
    const result = await page.evaluate(() => 6 * 7);
    if (result !== 42) throw new Error(`${engine} process launch returned ${result}, expected 42`);
    console.log(`${engine} process launch: ${withProcess.browser.version()} (pid ${withProcess.pid})`);
  } finally {
    await withProcess.close();
  }
}
