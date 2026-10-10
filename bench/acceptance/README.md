# Paired acceptance runner

`paired.mjs plan` validates and fingerprints both trees without running benchmarks. The measurement mode requires `LY_PERF_AUTHORIZED=YES` and is run only after the scheduled quiet window:

```bash
node bench/acceptance/paired.mjs plan --baseline ROOT --candidate ROOT --acceptance cpu-memory
LY_PERF_AUTHORIZED=YES node bench/acceptance/paired.mjs measure --baseline ROOT --candidate ROOT --runs 7 --acceptance cpu-memory
```

The default scope is `all`, which preserves the original acceptance behavior. `--acceptance cpu-memory` makes parse/stringify time, source and built facade profile time, peak RSS, and usable retained heap the blocking metrics. Cold import and bundle-size results remain informational for that scope.

Both scopes collect and retain the complete existing dataset: all 13 parse and 13 stringify speed rows, 42 source profiles, 8 built profiles, 26 parse/stringify memory rows per sample (25 iterations), ESM/CJS cold-import pairs, and the full five-bundler size reports. The plan and input manifest record the selected scope and full collection row counts. The summary keeps scoped misses in `over15Percent`, out-of-scope misses in `informationalOver15Percent`, and every measured miss in `allOver15Percent`; a cpu-memory pass explicitly states that startup and bundle results are informational.
