import { parentPort, workerData } from "node:worker_threads";
import * as yaml from "yaml";
import { register } from "tsx/esm/api";

register();

const compat = await import("../../../src/yaml-compat.ts");
const tokens = [...new compat.Parser().parse(workerData)];
const docs = tokens.filter((token) => token.type === "document");

parentPort.postMessage({
  offsets: docs.map((token) => token.offset),
  itemCount: docs[1]?.value?.items?.[0]?.value?.items?.length,
  reconstructed: tokens.map((token) => yaml.CST.stringify(token)).join(""),
});
