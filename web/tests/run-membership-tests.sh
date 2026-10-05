#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8080}"
membership_test_build=$(mktemp -d /tmp/pss-membership-test.XXXXXX)
trap 'rm -rf "$membership_test_build"' EXIT
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 --esModuleInterop --skipLibCheck --jsx react-jsx --outDir "$membership_test_build" \
 lib/membership/server.ts pages/api/projects/index.ts pages/api/projects/enter.ts
PSS_MEMBERSHIP_BUILD="$membership_test_build" NODE_PATH="$PWD/node_modules${NODE_PATH:+:$NODE_PATH}" node --test tests/membership-emulator.test.mjs
