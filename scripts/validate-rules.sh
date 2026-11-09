#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$BEARER_RULES_DIRECTORY"
has_archives=false
for archive in "$BEARER_RULES_DIRECTORY"/*.tar.gz; do
  [[ -f "$archive" ]] || continue
  if ! tar -tzf "$archive" > /dev/null 2>&1; then
    echo "::warning::Removing invalid Bearer rule archive: $(basename "$archive")"
    rm -- "$archive"
  else
    has_archives=true
  fi
done
echo "has-archives=$has_archives" >> "$GITHUB_OUTPUT"
