#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
experiment=experiments/dafny-hotpath
compiler="${1:-dafny}"
if [[ "$compiler" == */* ]]; then
  compiler="$(realpath "$compiler")"
fi
if [[ "${DAFNY_EXPERIMENT_SANDBOX:-}" != 1 ]]; then
  exec "$experiment/sandbox.sh" bash "$experiment/native-values/run.sh" "$compiler"
fi
node "$experiment/native-values/build.cjs" "$compiler"
