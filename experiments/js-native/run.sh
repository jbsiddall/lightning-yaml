#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_dir="$(mktemp -d "${TMPDIR:-/tmp}/lightning-yaml-js-native.XXXXXX")"
trap 'rm -rf "$run_dir"' EXIT

: "${LY_DAFNY:?Set LY_DAFNY to the stock Dafny 4.11 executable}"
: "${LY_NODE:?Set LY_NODE to Node 24}"

"$LY_DAFNY" translate js "$here/Consumer.dfy" --unicode-char false -o "$run_dir/Consumer.js"
if rg -q "_dafny|BigNumber" "$run_dir/Consumer.js"; then
  echo "POC unexpectedly depends on Dafny runtime or BigNumber" >&2
  exit 1
fi
cp "$here/checks.cjs" "$run_dir/"

run_case() {
  local name="$1"
  local adapter="$2"
  local case_dir="$run_dir/$name"
  mkdir "$case_dir"
  cp "$adapter" "$case_dir/js-native.cjs"
  cat "$run_dir/Consumer.js" "$run_dir/checks.cjs" > "$case_dir/Consumer.js"
  (cd "$case_dir" && "$LY_NODE" Consumer.js)
}

run_case correct "$here/js-native.cjs"

sed 's/array.push(value);/void value;/' "$here/js-native.cjs" > "$run_dir/bad-push.cjs"
if run_case bad-push "$run_dir/bad-push.cjs" >/dev/null 2>&1; then
  echo "wrong arrayPush adapter unexpectedly passed" >&2
  exit 1
fi

sed 's/object\[key\]/undefined/' "$here/js-native.cjs" > "$run_dir/bad-object-get.cjs"
if run_case bad-object-get "$run_dir/bad-object-get.cjs" >/dev/null 2>&1; then
  echo "wrong objectGet adapter unexpectedly passed" >&2
  exit 1
fi

mutant_dir="$run_dir/wrong-body"
mkdir "$mutant_dir"
cp "$here/JsNative.dfy" "$mutant_dir/"
sed 's/last := N.ArrayGet(items, length, heap);/last := N.ArrayGet(items, 0, heap);/' \
  "$here/Consumer.dfy" > "$mutant_dir/Consumer.dfy"
if ! rg -F -q 'last := N.ArrayGet(items, 0, heap);' "$mutant_dir/Consumer.dfy"; then
  echo "wrong-body mutation did not match the expected PushRead body" >&2
  exit 1
fi
if "$LY_DAFNY" translate js "$mutant_dir/Consumer.dfy" --unicode-char false \
  -o "$mutant_dir/Consumer.js" >"$run_dir/wrong-body.log" 2>&1; then
  echo "wrong PushRead body unexpectedly verified" >&2
  exit 1
fi
if ! rg -q 'postcondition could not be proved' "$run_dir/wrong-body.log"; then
  cat "$run_dir/wrong-body.log" >&2
  echo "wrong PushRead body failed for an unexpected reason" >&2
  exit 1
fi

if "$LY_DAFNY" translate js "$here/UnsupportedInjection.dfy" --no-verify --unicode-char false -o "$run_dir/UnsupportedInjection.js" >"$run_dir/unsupported.log" 2>&1; then
  echo "Array<int> unexpectedly converted into dynamic native Value" >&2
  exit 1
fi
if ! rg -q 'Array<Value>|ArrayValue|type mismatch' "$run_dir/unsupported.log"; then
  cat "$run_dir/unsupported.log" >&2
  echo "unsupported injection failed for an unexpected reason" >&2
  exit 1
fi

echo "native JS interop checks passed; wrong adapters and PushRead body failed, and Array<int> injection was rejected"
