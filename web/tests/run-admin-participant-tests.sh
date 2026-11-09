#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
participant_test_build=$(mktemp -d /tmp/pss-admin-participants.XXXXXX)
trap 'rm -rf "$participant_test_build"' EXIT
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 --esModuleInterop --resolveJsonModule --skipLibCheck --strict --lib esnext,dom,dom.iterable --jsx react-jsx --outDir "$participant_test_build" pages/api/projects/participant-summaries.ts pages/api/admin/executive-summary.ts lib/chat-history.ts
PSS_TEST_BUILD="$participant_test_build" NODE_PATH="$PWD/node_modules${NODE_PATH:+:$NODE_PATH}" node --test tests/admin-participants.test.mjs tests/chat-history.test.mjs
