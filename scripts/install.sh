#!/usr/bin/env bash
set -euo pipefail

verify_checksum() {
  [[ -f "$1" ]] && [[ "$(shasum -a 256 "$1" | cut -d ' ' -f 1)" == "$BEARER_CHECKSUM" ]]
}

mkdir -p "$(dirname "$BEARER_ARCHIVE")"
if ! verify_checksum "$BEARER_ARCHIVE"; then
  download=$(mktemp "${BEARER_ARCHIVE}.XXXXXX")
  trap 'rm -f "$download"' EXIT
  curl --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-max-time 90 \
    --connect-timeout 10 --max-time 60 \
    --output "$download" "$BEARER_URL"
  if ! verify_checksum "$download"; then
    echo "Bearer archive checksum mismatch" >&2
    exit 1
  fi
  tar -tzf "$download" > /dev/null
  mv "$download" "$BEARER_ARCHIVE"
else
  echo "Using verified cached Bearer archive"
fi

tar -xzf "$BEARER_ARCHIVE" -C "$RUNNER_TEMP" bearer
