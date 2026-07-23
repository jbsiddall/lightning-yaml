/** `yaml`'s memory-ratios entry — see entries/js-yaml.ts's header for why this doesn't import bench/candidates.ts. */
import { parse } from "yaml";
import { installMemoryHarness } from "../pageHarness.ts";

// maxAliasCount: -1 mirrors candidates.ts's yaml candidate — the rich
// fixtures reuse anchors thousands of times, past `yaml`'s default DoS guard.
installMemoryHarness((text) => parse(text, { maxAliasCount: -1 }));
