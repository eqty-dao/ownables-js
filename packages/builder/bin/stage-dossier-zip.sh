#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_ZIP="${PACKAGE_DIR}/dossier.zip"
TARGET_ZIP="${PACKAGE_DIR}/dist/builder/src/dossier.zip"

if [ ! -f "${SOURCE_ZIP}" ]; then
  echo "Failed to locate source dossier zip at ${SOURCE_ZIP}" >&2
  exit 1
fi

mkdir -p "$(dirname "${TARGET_ZIP}")"
cp "${SOURCE_ZIP}" "${TARGET_ZIP}"
echo "Staged dossier.zip to ${TARGET_ZIP}"
