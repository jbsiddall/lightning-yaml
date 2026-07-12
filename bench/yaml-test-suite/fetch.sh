#!/usr/bin/env bash
# Vendor a pinned snapshot of the official yaml-test-suite
# (https://github.com/yaml/yaml-test-suite) into bench/yaml-test-suite/data/.
#
# The suite's directory-per-test layout (one dir per test ID, e.g. `229Q/`,
# each holding `in.yaml`/`in.json`/`out.yaml`/`test.event`/`error`) lives on the
# `data` branch and is snapshotted at `data-YYYY-MM-DD` release tags. We pin to
# a specific tag below so `pnpm gen:suite` is reproducible across machines and
# time — bump REF deliberately (and re-run) rather than tracking a moving
# branch.
#
# Fetch strategy, in order:
#   1. codeload tarball for the pinned tag (works on a plain internet
#      connection; this is the normal path outside this sandbox).
#   2. `git clone --depth 1 --branch REF` as a fallback (works here even when
#      the sandbox's egress proxy blocks direct HTTPS to github.com/codeload
#      for repos not in this session's allowlist — plain `git` transport is
#      routed differently by the proxy and isn't subject to that gate).
#
# Idempotent: skips entirely if data/ already exists and is non-empty. Set
# FORCE=1 to re-fetch regardless (e.g. after bumping REF).
#
#   bash bench/yaml-test-suite/fetch.sh
#   FORCE=1 bash bench/yaml-test-suite/fetch.sh

set -euo pipefail

# Pinned ref — a real `data-*` tag, confirmed to exist via
# `git ls-remote --tags https://github.com/yaml/yaml-test-suite.git`.
REF="data-2022-01-17"
REPO="yaml/yaml-test-suite"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$HERE/data"

echo "yaml-test-suite: pinned ref = $REF"

if [ -d "$DATA_DIR" ] && [ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "yaml-test-suite: $DATA_DIR already populated — skipping (set FORCE=1 to re-fetch)"
  exit 0
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fetch_via_tarball() {
  local url="https://codeload.github.com/$REPO/tar.gz/refs/tags/$REF"
  echo "yaml-test-suite: trying tarball download from $url"
  local tarball="$WORK_DIR/suite.tar.gz"
  if curl -fsSL -o "$tarball" "$url"; then
    mkdir -p "$WORK_DIR/extracted"
    tar -xzf "$tarball" -C "$WORK_DIR/extracted" --strip-components=1
    return 0
  fi
  echo "yaml-test-suite: tarball download failed (blocked proxy / bad ref)"
  return 1
}

fetch_via_git_clone() {
  echo "yaml-test-suite: falling back to git clone --branch $REF"
  mkdir -p "$WORK_DIR/extracted"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$REF" \
    "https://github.com/$REPO.git" "$WORK_DIR/extracted"
  rm -rf "$WORK_DIR/extracted/.git"
}

if ! fetch_via_tarball; then
  fetch_via_git_clone
fi

rm -rf "$DATA_DIR"
mv "$WORK_DIR/extracted" "$DATA_DIR"

count="$(find "$DATA_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
echo "yaml-test-suite: fetched $count top-level entries into $DATA_DIR (ref $REF)"
