/**
 * js-yaml's memory-ratios entry — esbuild's own entry point (see
 * memoryRun.ts), so the OUTPUT BUNDLE contains js-yaml and nothing else from
 * the candidate registry (yaml, lightning-yaml never get imported here at
 * all). Deliberately does NOT import bench/candidates.ts: that single module
 * imports every candidate's library unconditionally, so pulling any binding
 * from it — even just the pure `candidateApplies` helper — would drag every
 * competing library's code into this bundle too, defeating the fresh-page,
 * one-library-only isolation this harness needs. The small duplication of
 * candidates.ts's `!!binary`-schema note below is the price of that isolation.
 */
import { load, YAML11_SCHEMA } from "js-yaml";
import { installMemoryHarness } from "../pageHarness.ts";

// Mirrors candidates.ts's jsYamlParse: js-yaml's CORE default schema doesn't
// define `!!binary` (correctly, for YAML 1.2), so the rich fixtures need the
// YAML 1.1 schema to load.
installMemoryHarness((text, category) => load(text, category === "yaml-rich" ? { schema: YAML11_SCHEMA } : undefined));
