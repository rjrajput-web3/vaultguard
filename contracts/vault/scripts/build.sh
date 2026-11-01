#!/bin/bash
# VAULTGUARD contract build wrapper.
# near-sdk-js resolves tsc/qjsc via cwd-relative node_modules paths; with npm
# workspaces those binaries are hoisted to the repo root, so we symlink them
# into the contract's node_modules before building.
set -e
cd "$(dirname "$0")/.."
mkdir -p node_modules/.bin
[ -e node_modules/.bin/tsc ] || ln -s ../../../../node_modules/.bin/tsc node_modules/.bin/tsc
[ -e node_modules/near-sdk-js ] || ln -s ../../../node_modules/near-sdk-js node_modules/near-sdk-js
../../node_modules/.bin/near-sdk-js build src/index.ts build/contract.wasm package.json tsconfig.json
