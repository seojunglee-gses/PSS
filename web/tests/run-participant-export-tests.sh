#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export_test_build=$(mktemp -d /tmp/pss-participant-export.XXXXXX)
trap 'rm -rf "$export_test_build"' EXIT
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 --esModuleInterop --resolveJsonModule --skipLibCheck --strict --lib esnext,dom,dom.iterable --jsx react-jsx --outDir "$export_test_build" pages/api/admin/participant-export.ts lib/participant-export.ts
PSS_TEST_BUILD="$export_test_build" NODE_PATH="$PWD/node_modules${NODE_PATH:+:$NODE_PATH}" node --test tests/participant-export.test.mjs
