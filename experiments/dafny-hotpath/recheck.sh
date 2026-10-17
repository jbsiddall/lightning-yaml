#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
experiment=experiments/dafny-hotpath
tooling="$(realpath "${1:-$PWD/node_modules}")"
compiler="${2:-dafny}"
if [[ "$compiler" == */* ]]; then
  compiler="$(realpath "$compiler")"
fi

# Always put compiler, dependency execution and optimizer execution in bwrap.
# Add node to PATH before invoking this script. No dependencies are downloaded.
if [[ "${DAFNY_EXPERIMENT_SANDBOX:-}" != 1 ]]; then
  exec "$experiment/sandbox.sh" bash "$experiment/recheck.sh" "$tooling" "$compiler"
fi
if [[ ! -d "$experiment/node_modules/bignumber.js" ]]; then
  echo "Missing pinned experiment dependency bignumber.js (see package-lock.json)" >&2
  exit 1
fi
"$compiler" --version
for name in Scan Native; do
  "$compiler" build --target js --unicode-char true --output "$experiment/$name.js" \
    --spill-translation "$experiment/$name.dfy"
done
"$compiler" build --target js --unicode-char false --output "$experiment/NativeUtf16.js" \
  --spill-translation "$experiment/Native.dfy"
"$compiler" build --target js --unicode-char false --output "$experiment/Shapes.js" \
  --spill-translation "$experiment/Shapes.dfy"
"$compiler" build --target js --unicode-char false --output "$experiment/DirectCast.js" \
  --spill-translation "$experiment/DirectCast.dfy"
"$compiler" build --target js --unicode-char false --output "$experiment/NativeChoices.js" \
  --spill-translation "$experiment/NativeChoices.dfy"
# This flag explicitly acknowledges that the external JS must obey its contract.
"$compiler" build --target js --unicode-char false --allow-external-contracts \
  --output "$experiment/ExternHotPath.js" --spill-translation "$experiment/ExternHotPath.dfy"
node "$experiment/postprocess.cjs" "$tooling" | tee "$experiment/postprocess-results.jsonl"
node "$experiment/inspect-output.cjs" "$tooling"
node "$experiment/recheck.cjs" | tee "$experiment/recheck-results.jsonl"
