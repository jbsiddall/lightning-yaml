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
  src/dafny/core/SurfaceModel.dfy src/dafny/core/Binary64Scale.dfy \
  src/dafny/core/NativeBudgetContracts.dfy src/dafny/core/NativeContracts.dfy \
  src/dafny/core/FacadeFlow.dfy src/dafny/core/FacadeContracts.dfy \
  src/dafny/core/PublicObjects.dfy src/dafny/core/ObjectsAndErrors.dfy \
  src/dafny/core/ErrorTranslation.dfy src/dafny/core/HostObservation.dfy \
  src/dafny/core/SurfaceWitness.dfy \
  src/dafny/core/NativeTraceLemmas.dfy \
  src/dafny/core/NativePhaseIntro.dfy \
  src/dafny/core/NativePrefixComposition.dfy \
  src/dafny/core/NativeParseComposition.dfy \
  src/dafny/core/NativeParseTransport.dfy \
  src/dafny/core/NativeErrorTextContracts.dfy \
  src/dafny/core/RawMarkContracts.dfy \
  src/dafny/surfaces/NativeSurface.dfy
node scripts/build-dafny.cjs "$@" --input "$temporary/Native.js"
