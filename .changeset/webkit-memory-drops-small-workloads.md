---
---

The in-browser memory comparison on the benchmarks page no longer publishes the two smallest (~1 KB) workloads for Safari's engine (WebKit). Chrome's engine still publishes all six, and nothing else about the tables changes.

**Why: peak memory can't see a 1 KB parse.** WebKit gives a page no way to read its own JavaScript heap, so that column reports the operating system's peak memory for the process running the page — which includes everything a library needed just to be loaded and warmed up, not only what the parse allocated. Re-running that measurement four times at each batch size K (how many parses of the file are kept alive at once), on the ~1 KB block-YAML file:

| library        | K=60    | K=300   | K=900   |
| -------------- | ------- | ------- | ------- |
| js-yaml        | 4.7 MB  | 9.7 MB  | 24.2 MB |
| yaml           | 29.9 MB | 25.7 MB | 25.5 MB |
| lightning-yaml | 3.0 MB  | 2.9 MB  | 6.9 MB  |

`yaml` costs about 26 MB whether the file is parsed 60 times or 900 — that is its fixed footprint (parser machinery, first-use heap growth), not memory spent per parse. At K=60 that fixed cost swamps the parse itself, and that is exactly what produced the `yaml: 11.467×` figure previously published on that row. Push K up until the parsing dominates and the same ratio collapses to roughly 3-4×, in line with `yaml`'s own medium and large workloads (2.9-3.9×). So the row was measuring footprint while being labelled parse memory — and it happened to be the most flattering number in the whole table, which is precisely why it goes: this project reports the honest result even when the honest result is less impressive.

**The obvious fix doesn't work.** The hypothesis was that parsing the small file far more times would let the real signal outgrow the allocator and garbage-collector noise (the published figures are ratios, so a bigger batch needs no rescaling). It doesn't: the run-to-run spread stayed flat at about 5-8% for every library at every batch size — 60, 300 and 900 alike. Bigger batches shifted the ratio systematically, because they removed the footprint bias, but bought nothing in stability.

**What was considered.** Three options: (a) drop the small workloads from the WebKit measurement only; (b) parse the small file many more times than the big ones, which would make the published "iterations" figure differ per workload and still leave those rows around 15% noisy run to run; (c) keep the rows and add a warning next to them. (a) won — the smallest change, no data-format churn, and it removes a number that flattered us rather than one that hurt us. Chrome's engine keeps its small workloads because it answers a different question there: it forces a garbage collection and measures only what the parsed result still holds onto, which a fixed footprint doesn't distort at that size.
