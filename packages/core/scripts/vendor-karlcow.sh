#!/bin/bash
# Vendors the INPUTS of karlcow/markdown-testsuite (MIT) at a pinned SHA.
# The `.out` expectation files are deliberately NOT copied: they encode a pre-CommonMark
# reference implementation and would fight SPEC 4.1.
#
# michelf/mdtest is GPL-2.0 and must never be vendored here — readit is embedded by third
# parties and a GPL test corpus is a downstream legal blocker.
set -euo pipefail

REPO=https://github.com/karlcow/markdown-testsuite.git
SHA=92d125d8d97f1c01191c84404b13319f60b38502
DEST="$(cd "$(dirname "$0")/../test/corpus/adversarial" && pwd)/karlcow"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -C "$TMP" init -q
git -C "$TMP" remote add origin "$REPO"
git -C "$TMP" fetch -q --depth 1 origin "$SHA"
git -C "$TMP" checkout -q FETCH_HEAD

ACTUAL="$(git -C "$TMP" rev-parse HEAD)"
if [ "$ACTUAL" != "$SHA" ]; then
  echo "vendor-karlcow: expected $SHA, got $ACTUAL" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$TMP"/tests/*.md "$DEST"/
cp "$TMP"/LICENSE.md "$DEST"/LICENSE.txt
printf '{\n  "repo": "karlcow/markdown-testsuite",\n  "ref": "%s",\n  "license": "MIT",\n  "vendored": "tests/*.md inputs only; .out expectations excluded"\n}\n' "$SHA" > "$DEST"/PROVENANCE.json

COUNT="$(find "$DEST" -name '*.md' | wc -l | tr -d ' ')"
echo "vendored $COUNT karlcow inputs to $DEST"
[ "$COUNT" -eq 103 ] || { echo "expected 103 inputs, got $COUNT" >&2; exit 1; }
