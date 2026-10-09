#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
experiment=experiments/dafny-hotpath
compiler="${1:-dafny}"
if [[ "$compiler" == */* ]]; then
  compiler="$(realpath "$compiler")"
fi
if [[ "${DAFNY_EXPERIMENT_SANDBOX:-}" != 1 ]]; then
  exec "$experiment/sandbox.sh" bash "$experiment/run.sh" "$compiler"
fi
if [[ ! -d "$experiment/node_modules/bignumber.js" ]]; then
  echo "Install the pinned experiment dependency before entering the sandbox" >&2
  exit 1
fi
export NODE_PATH="$experiment/node_modules"
for name in Scan Native CodeUnits MoreHotPaths; do
  "$compiler" build --target js --unicode-char true --output "$experiment/$name.js" --spill-translation "$experiment/$name.dfy"
done
ITERATIONS="${ITERATIONS:-3000}" node "$experiment/bench.cjs"
ITERATIONS="${ITERATIONS_MORE:-10000}" node "$experiment/more-bench.cjs"
