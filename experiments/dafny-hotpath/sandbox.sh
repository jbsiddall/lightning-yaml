#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
mkdir -p "$repo/.sandbox-home" "$repo/.sandbox-tmp"
exec bwrap \
  --ro-bind / / \
  --dev /dev --proc /proc \
  --bind "$repo" "$repo" \
  --unshare-all --die-with-parent --new-session \
  --clearenv \
  --setenv PATH "$PATH" \
  --setenv NODE_PATH "$repo/experiments/dafny-hotpath/node_modules" \
  --setenv HOME "$repo/.sandbox-home" \
  --setenv TMPDIR "$repo/.sandbox-tmp" \
  --setenv XDG_CACHE_HOME "$repo/.sandbox-home/.cache" \
  --setenv DAFNY_EXPERIMENT_SANDBOX 1 \
  --setenv ITERATIONS "${ITERATIONS:-5000}" \
  --setenv ITERATIONS_MORE "${ITERATIONS_MORE:-10000}" \
  --chdir "$repo" \
  -- "$@"
