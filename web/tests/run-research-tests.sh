#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
research_test_build=$(mktemp -d /tmp/pss-research-test.XXXXXX)
trap 'rm -rf "$research_test_build"' EXIT
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 --esModuleInterop --resolveJsonModule --skipLibCheck --strict --lib esnext,dom,dom.iterable --jsx react-jsx --outDir "$research_test_build" \
  pages/api/projects/analysis-review.ts lib/spatial/boundary.ts lib/spatial/analysis-review.ts lib/spatial/geo-query.ts lib/spatial/kakao-server.ts lib/spatial/geo-server.ts lib/spatial/kakao-map.ts pages/api/spatial/query.ts \
  lib/i18n.tsx lib/content-format.ts lib/workspace-layout.ts lib/sidebar-preference.ts lib/spatial/goals.ts lib/spatial/engine.ts lib/spatial/loader.ts lib/spatial/context.ts lib/chat-history.ts lib/research/answer.ts lib/research/evidence.ts lib/research/openalex.ts lib/research/types.ts \
  pages/api/admin/background-knowledge.ts pages/api/admin/site-image.ts pages/api/generate-alternative.ts pages/api/projects/content-image.ts lib/storage-upload.ts pages/api/chat.ts pages/api/research/search.ts pages/api/research/answer.ts
PSS_TEST_BUILD="$research_test_build" NODE_PATH="$PWD/node_modules${NODE_PATH:+:$NODE_PATH}" node --test tests/boundary.test.mjs tests/geo.test.mjs tests/localization.test.mjs tests/research.test.mjs tests/chat-history.test.mjs tests/spatial.test.mjs tests/spatial-goals.test.mjs tests/sidebar-preference.test.mjs tests/workspace-layout.test.mjs tests/content-format.test.mjs tests/project-data-flow.test.mjs
