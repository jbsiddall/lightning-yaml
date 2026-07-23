/** lightning-yaml's memory-ratios entry — see entries/js-yaml.ts's header for why this doesn't import bench/candidates.ts. */
import { parse } from "../../../../src/index.ts";
import { installMemoryHarness } from "../pageHarness.ts";

installMemoryHarness((text) => parse(text));
