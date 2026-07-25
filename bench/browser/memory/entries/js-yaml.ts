/**
 * js-yaml's memory-ratios entry. Each entry imports exactly one library — going through
 * bench/candidates.ts instead would pull every competitor's code into this page's bundle.
 */
import { load, YAML11_SCHEMA } from "js-yaml";
import { installMemoryHarness } from "../pageHarness.ts";

// Same schema choice as candidates.ts: js-yaml's CORE default has no `!!binary`, which the rich fixtures need.
installMemoryHarness((text, category) => load(text, category === "yaml-rich" ? { schema: YAML11_SCHEMA } : undefined));
