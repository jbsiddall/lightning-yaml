/**
 * Memory-measurement worker for the POC baseline.
 *
 * Spawned by baseline.ts — one child process per (library, op, fixture) cell.
 * Runs the operation N times, reports peak RSS and heap delta as a JSON line.
 *
 * Args: <fixturePath> <library> <op> <iters> <isMultidoc>
 */

import { readFileSync } from "node:fs";
import * as yamlLib from "yaml";
import * as jsYaml from "js-yaml";
import { parse as lyParse, stringify as lyStringify } from "../../../src/index.ts";
import {
  parse as pocParse,
  parseDocument as pocParseDocument,
  parseAllDocuments as pocParseAllDocuments,
} from "../src/index.ts";

const [fixturePath, library, op, itersStr, isMultidocStr] = process.argv.slice(2);
const iters = Number(itersStr);
const isMultidoc = isMultidocStr === "1";
const text = readFileSync(fixturePath!, "utf8");

function runOp(): void {
  switch (library) {
    case "yaml": {
      switch (op) {
        case "parse":
          if (isMultidoc) yamlLib.parseAllDocuments(text);
          else yamlLib.parse(text);
          break;
        case "parseDocument":
          if (isMultidoc) yamlLib.parseAllDocuments(text);
          else yamlLib.parseDocument(text);
          break;
        case "parseDocument+toJS": {
          const docs = isMultidoc
            ? yamlLib.parseAllDocuments(text)
            : [yamlLib.parseDocument(text)];
          for (const d of docs) d.toJS();
          break;
        }
        case "stringify(doc)":
          if (isMultidoc) {
            const docs = yamlLib.parseAllDocuments(text);
            for (const d of docs) d.toString();
          } else {
            yamlLib.parseDocument(text).toString();
          }
          break;
        case "round-trip":
          if (isMultidoc) {
            const docs = yamlLib.parseAllDocuments(text);
            for (const d of docs) yamlLib.parseDocument(d.toString());
          } else {
            yamlLib.parseDocument(yamlLib.parseDocument(text).toString());
          }
          break;
        default:
          throw new Error(`unknown yaml op: ${op}`);
      }
      break;
    }
    case "js-yaml": {
      switch (op) {
        case "load":
          if (isMultidoc) jsYaml.loadAll(text);
          else jsYaml.load(text);
          break;
        case "dump": {
          const parsed = isMultidoc ? jsYaml.loadAll(text) : jsYaml.load(text);
          if (Array.isArray(parsed) && isMultidoc) {
            for (const d of parsed) jsYaml.dump(d);
          } else {
            jsYaml.dump(parsed);
          }
          break;
        }
        default:
          throw new Error(`unknown js-yaml op: ${op}`);
      }
      break;
    }
    case "lightning-yaml": {
      switch (op) {
        case "parse":
          lyParse(text);
          break;
        case "stringify":
          lyStringify(lyParse(text));
          break;
        default:
          throw new Error(`unknown lightning-yaml op: ${op}`);
      }
      break;
    }
    case "poc": {
      switch (op) {
        case "parse":
          if (isMultidoc) pocParseAllDocuments(text);
          else pocParse(text);
          break;
        case "parseDocument":
          if (isMultidoc) pocParseAllDocuments(text);
          else pocParseDocument(text);
          break;
        case "parseDocument+toJS": {
          const docs = isMultidoc
            ? pocParseAllDocuments(text)
            : [pocParseDocument(text)];
          for (const d of docs) d.toJS();
          break;
        }
        default:
          throw new Error(`unknown poc op: ${op}`);
      }
      break;
    }
    default:
      throw new Error(`unknown library: ${library}`);
  }
}

// Warm-up: one run to get past cold-start.
runOp();
if (typeof global.gc === "function") global.gc();

const before = process.memoryUsage();
const rssSamples: number[] = [];

for (let i = 0; i < iters; i++) {
  runOp();
  rssSamples.push(process.memoryUsage.rss());
}

if (typeof global.gc === "function") global.gc();
const after = process.memoryUsage();

const peakRss = Math.max(...rssSamples, after.rss);
// GC between iterations can shrink heap below the pre-warmup baseline,
// producing negative deltas that don't reflect real allocation. Clamp to 0.
const heapDelta = Math.max(0, after.heapUsed - before.heapUsed);

const result = {
  library,
  op,
  peakRssBytes: peakRss,
  heapDeltaBytes: heapDelta,
};

// Single JSON line on stdout — the orchestrator parses the last line.
console.log(JSON.stringify(result));
