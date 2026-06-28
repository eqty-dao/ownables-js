#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PACKAGE_DIR}/../.." && pwd)"

LOCAL_ZIP="${PACKAGE_DIR}/dossier.zip"
SOURCE_ZIP="${REPO_ROOT}/ownables/dossier.zip"

if [ -f "${LOCAL_ZIP}" ]; then
  echo "dossier.zip already exists at ${LOCAL_ZIP}"
  exit 0
fi

if [ ! -f "${SOURCE_ZIP}" ]; then
  echo "Building ownables dossier zip..."
  (
    cd "${REPO_ROOT}"
    bash ./bin/ownables-build.sh dossier
  )
fi

if [ ! -f "${SOURCE_ZIP}" ]; then
  echo "Failed to locate source dossier zip at ${SOURCE_ZIP}" >&2
  exit 1
fi

cp "${SOURCE_ZIP}" "${LOCAL_ZIP}"
echo "Copied dossier.zip to ${LOCAL_ZIP}"
