import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();

const compat = await import("../../../src/yaml-compat.ts");
parentPort.postMessage({ ready: true });

try {
  const doc = compat.parseDocument(workerData);
  parentPort.postMessage({
    value: doc.toJS(),
    errors: doc.errors.map((error) => error.code),
    range: doc.range,
    sourceLength: workerData.length,
  });
} catch (error) {
  parentPort.postMessage({ error: String(error) });
}
