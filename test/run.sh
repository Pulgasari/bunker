#!/bin/sh
# smoke tests. node has no dom, so each suite runs twice where it matters:
# once on the memory fallback, once against node's experimental web storage.
# @bunker/* resolves to the sources through test/helpers/imports.mjs.
set -e
cd "$(dirname "$0")/.."

run () { node --import ./test/helpers/imports.mjs "$@"; }

run test/core.test.mjs
run test/utils.test.mjs
run test/storage.test.mjs
run test/db.test.mjs
run test/cache.test.mjs
run test/opfs.test.mjs
run test/policy.test.mjs
run test/kit.test.mjs
EXPECT_PERSISTENT=1 run --experimental-webstorage \
  --localstorage-file="${TMPDIR:-/tmp}/bunker-test-localstorage" \
  test/storage.test.mjs 2>/dev/null
