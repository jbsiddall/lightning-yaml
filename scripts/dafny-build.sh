#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compiler="${DAFNY:-dafny}"
version="$($compiler --version)"
found_version=''
if [[ "$version" =~ (^|[^0-9])([0-9]+\.[0-9]+\.[0-9]+)([^0-9]|$) ]]; then
  found_version="${BASH_REMATCH[2]}"
fi
if [[ "$found_version" != "4.11.0" ]]; then
  printf 'Dafny 4.11.0 is required; %s reported %s\n' "$compiler" "$version" >&2
  exit 1
fi

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
cd "$repo_root"
"$compiler" translate js --unicode-char false --no-verify --include-runtime \
  --output "$temporary/Native.js" \
  src/dafny/core/Native.dfy src/dafny/core/TagValues.dfy src/dafny/core/Engine.dfy src/dafny/core/Serializer.dfy \
  src/dafny/core/SurfaceValues.dfy src/dafny/core/SurfaceOptions.dfy \
  src/dafny/core/SurfaceHelpers.dfy src/dafny/core/SurfaceErrors.dfy src/dafny/core/SurfaceHost.dfy \
  src/dafny/surfaces/NativeSurface.dfy
node scripts/build-dafny.cjs "$@" --input "$temporary/Native.js"
