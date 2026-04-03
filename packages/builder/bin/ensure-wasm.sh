#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PACKAGE_DIR}/../.." && pwd)"

LOCAL_WASM="${PACKAGE_DIR}/ownable_bg.wasm"
SOURCE_WASM="${REPO_ROOT}/ownables/dossier/pkg/ownable_bg.wasm"

if [ -f "${LOCAL_WASM}" ]; then
  echo "ownable_bg.wasm already exists at ${LOCAL_WASM}"
  exit 0
fi

if [ ! -f "${SOURCE_WASM}" ]; then
  echo "Building ownables dossier wasm..."
  (
    cd "${REPO_ROOT}"
    bash ./bin/ownables-build.sh dossier
  )
fi

if [ ! -f "${SOURCE_WASM}" ]; then
  echo "Failed to locate source wasm at ${SOURCE_WASM}" >&2
  exit 1
fi

cp "${SOURCE_WASM}" "${LOCAL_WASM}"
echo "Copied wasm to ${LOCAL_WASM}"
