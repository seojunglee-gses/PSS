#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
research_test_build=$(mktemp -d /tmp/pss-research-test.XXXXXX)
trap 'rm -rf "$research_test_build"' EXIT
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 --esModuleInterop --skipLibCheck --outDir "$research_test_build" \
  lib/chat-history.ts lib/research/answer.ts lib/research/evidence.ts lib/research/openalex.ts lib/research/types.ts \
  pages/api/research/search.ts pages/api/research/answer.ts
PSS_TEST_BUILD="$research_test_build" NODE_PATH="$PWD/node_modules${NODE_PATH:+:$NODE_PATH}" node --test tests/research.test.mjs tests/chat-history.test.mjs
