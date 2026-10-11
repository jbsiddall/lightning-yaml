import { parentPort } from "node:worker_threads";
import { evaluateCST } from "./cst.js";

if (!parentPort) throw new Error("cst-worker must run in a worker thread");
parentPort.on("message", async (request: { id: number; source: string }) => {
  try {
    parentPort!.postMessage({
      id: request.id,
      outcome: await evaluateCST(request.source),
    });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: String(error) });
  }
});
