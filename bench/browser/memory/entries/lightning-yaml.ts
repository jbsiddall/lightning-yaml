/** lightning-yaml's memory-ratios entry — see entries/js-yaml.ts for why no entry imports bench/candidates.ts. */
import { parse } from "../../../../src/index.ts";
import { installMemoryHarness } from "../pageHarness.ts";

installMemoryHarness((text) => parse(text));
