#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8080}"
spatial_dataset_build=$(mktemp -d /tmp/pss-spatial-dataset-test.XXXXXX)
trap 'rm -rf "$spatial_dataset_build"' EXIT
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 --esModuleInterop --skipLibCheck --jsx react-jsx --outDir "$spatial_dataset_build" lib/spatial/dataset-server.ts pages/api/projects/spatial-datasets.ts
PSS_DATASET_BUILD="$spatial_dataset_build" NODE_PATH="$PWD/node_modules${NODE_PATH:+:$NODE_PATH}" node --test tests/spatial-datasets.test.mjs
