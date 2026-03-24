#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$ROOT_DIR/artifacts"
TARGET_WASM="$ROOT_DIR/target/wasm32-unknown-unknown/release/ownable_static.wasm"

mkdir -p "$ARTIFACTS_DIR"

(
  cd "$ROOT_DIR"
  cargo build --release --target wasm32-unknown-unknown
  cargo run --example schema
)

cp "$TARGET_WASM" "$ARTIFACTS_DIR/ownable-static.wasm"
node "$ROOT_DIR/scripts/generate-code-hash.mjs" "$ARTIFACTS_DIR/ownable-static.wasm" "$ARTIFACTS_DIR/code-hash-manifest.json"
