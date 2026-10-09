# poc/yaml-compat — yaml-lib AST-compatible parser POC

Proof-of-concept reimplementation of `eemeli/yaml` v2's AST API
(`parseDocument` / `parseAllDocuments` / `stringify` / Document layer) targeting
>=2x speed and <=50% peak memory of the incumbent.

This directory holds the **baseline**: measured numbers for `yaml` v2.9.0,
`js-yaml` v5.2.1, and `lightning-yaml` on representative workloads. Later PRs
in the stack prove gains against these numbers.

## Run the baseline

```bash
# 1. Generate fixtures (deterministic, no network)
node --import tsx poc/yaml-compat/bench/corpus.ts

# 2. Run the benchmark (speed + memory, ~2-3 min)
node --expose-gc --import tsx poc/yaml-compat/bench/baseline.ts
```

Results land in `poc/yaml-compat/results/baseline.yaml` with machine, node
version, library versions, and git SHA in the header.
