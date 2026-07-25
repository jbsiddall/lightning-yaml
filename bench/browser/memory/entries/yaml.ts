/** `yaml`'s memory-ratios entry — see entries/js-yaml.ts for why no entry imports bench/candidates.ts. */
import { parse } from "yaml";
import { installMemoryHarness } from "../pageHarness.ts";

// maxAliasCount: -1 mirrors candidates.ts — the rich fixtures reuse anchors past `yaml`'s default DoS guard.
installMemoryHarness((text) => parse(text, { maxAliasCount: -1 }));
