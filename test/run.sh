#!/bin/sh
# smoke tests. node has no dom, so each suite runs twice where it matters:
# once on the memory fallback, once against node's experimental web storage.
set -e
cd "$(dirname "$0")/.."

node test/core.test.mjs
node test/storage.test.mjs
node test/db.test.mjs
EXPECT_PERSISTENT=1 node --experimental-webstorage \
  --localstorage-file="${TMPDIR:-/tmp}/bunker-test-localstorage" \
  test/storage.test.mjs 2>/dev/null
