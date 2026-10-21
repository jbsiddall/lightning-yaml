import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();

const compat = await import("../../../src/yaml-compat.ts");
const tokens = [...new compat.Parser().parse(workerData)];
const docs = [...new compat.Composer({ keepSourceTokens: true }).compose(tokens)];
const firstFlow = docs[1]?.contents?.items?.[0]?.value;

parentPort.postMessage({
  ranges: docs.map((doc) => doc.range),
  itemCount: firstFlow?.items?.length,
  middleErrors: docs[1]?.errors.map((error) => error.code),
  finalValue: docs[2]?.toJS(),
});
