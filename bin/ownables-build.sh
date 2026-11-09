#!/usr/bin/env bash
set -euo pipefail

create_deterministic_zip() {
  local output=$1
  shift
  local output_dir
  local output_name
  local staging

  output_dir="$(cd "$(dirname "$output")" && pwd)"
  output_name="$(basename "$output")"
  output="${output_dir}/${output_name}"
  staging="$(mktemp -d)"

  for input in "$@"; do
    if [ -d "$input" ]; then
      while IFS= read -r file; do
        local destination="${staging}/$(basename "$file")"
        if [ -e "$destination" ]; then
          echo "Duplicate archive entry: $(basename "$file")" >&2
          rm -rf "$staging"
          return 1
        fi
        cp "$file" "$destination"
      done < <(find "$input" -type f -print | LC_ALL=C sort)
    else
      local destination="${staging}/$(basename "$input")"
      if [ -e "$destination" ]; then
        echo "Duplicate archive entry: $(basename "$input")" >&2
        rm -rf "$staging"
        return 1
      fi
      cp "$input" "$destination"
    fi
  done

  find "$staging" -type f -exec touch -t 198001010000 {} +
  (
    cd "$staging"
    set --
    while IFS= read -r entry; do
      set -- "$@" "$entry"
    done < <(find . -type f -print | LC_ALL=C sort)
    zip -X -q "$output" "$@"
  )
  rm -rf "$staging"
}

build_package() {
  local name=$1
  local dir="./ownables/$name"

  if [ -f "$dir/Cargo.toml" ]; then
    local package_name
    local package_version
    local package_description
    local package_keywords
    local crate_name
    local wasm_path

    package_name="$(awk -F '\"' '/^name = /{print $2; exit}' "$dir/Cargo.toml")"
    package_version="$(awk -F '\"' '/^version = /{print $2; exit}' "$dir/Cargo.toml")"
    package_description="$(awk -F '\"' '/^description = /{print $2; exit}' "$dir/Cargo.toml" || true)"
    package_keywords="$(
      cargo metadata --format-version 1 --no-deps --manifest-path "$dir/Cargo.toml" \
        | jq --arg name "$package_name" -c '
            (.packages[] | select(.name == $name) | .metadata.ownables.package.keywords) // []
          '
    )"
    crate_name="${package_name//-/_}"
    wasm_path="./ownables/target/wasm32-unknown-unknown/release/${crate_name}.wasm"

    rm -rf "$dir/pkg/"
    rm -f "./ownables/$name.zip"
    mkdir -p "$dir/pkg/"

    (
      cd ./ownables
      cargo build --locked -p "$package_name" --target wasm32-unknown-unknown --release
    )

    cp "$wasm_path" "$dir/pkg/ownable_bg.wasm"

    jq -n \
      --arg name "$package_name" \
      --arg version "$package_version" \
      --arg description "$package_description" \
      --arg ownablesAbi "1" \
      --arg wireFormat "cbor" \
      --argjson keywords "$package_keywords" \
      '{
        name: $name,
        version: $version,
        description: $description,
        keywords: $keywords,
        ownablesAbi: $ownablesAbi,
        wireFormat: $wireFormat
      }' > "$dir/pkg/package.json"

    (cd "$dir" && cargo run --example schema)
    local zip_inputs=("$dir/pkg/ownable_bg.wasm" "$dir/pkg/package.json" "$dir/schema/"*.json)
    if [ -d "$dir/assets" ]; then
      zip_inputs=("$dir/assets/" "${zip_inputs[@]}")
    fi
    create_deterministic_zip "./ownables/$name.zip" "${zip_inputs[@]}"
  else
    rm -f "./ownables/$name.zip"
    create_deterministic_zip "./ownables/$name.zip" "$dir/"*
  fi
}

if [ -n "${1-}" ]; then
  build_package "$1"
else
  for dir in ./ownables/*/; do
    name="$(basename "$dir")"
    [ "$name" = "target" ] && continue
    build_package "$name"
  done
fi
