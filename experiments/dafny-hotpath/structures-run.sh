#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
experiment=experiments/dafny-hotpath
compiler="${1:-dafny}"
if [[ "$compiler" == */* ]]; then
  compiler="$(realpath "$compiler")"
fi
if [[ "${DAFNY_EXPERIMENT_SANDBOX:-}" != 1 ]]; then
  exec "$experiment/sandbox.sh" bash "$experiment/structures-run.sh" "$compiler"
fi
for name in Structures OpaqueValue; do
  "$compiler" build --target js --unicode-char false --allow-external-contracts \
    --spill-translation --output "$experiment/$name.js" "$experiment/$name.dfy"
done
node "$experiment/structures-check.cjs"
