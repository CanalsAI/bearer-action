#!/usr/bin/env bash
set -euo pipefail

release_info() {
  jq -er --arg platform "$BEARER_PLATFORM" '
    .tag_name as $tag |
    if ($tag | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) then
      .assets[] |
      select(.name == "bearer_" + ($tag | ltrimstr("v")) + "_" + $platform + ".tar.gz") |
      select(.digest | test("^sha256:[a-f0-9]{64}$")) |
      [$tag, .name, (.digest | ltrimstr("sha256:"))] | @tsv
    else error("Expected a stable Bearer release with a SHA-256 digest") end
  ' "$1"
}

mkdir -p "$(dirname "$BEARER_RELEASE_FILE")"
if [[ "$BEARER_RELEASE_CACHE_HIT" != true ]] || ! release_info "$BEARER_RELEASE_FILE" > /dev/null 2>&1; then
  download=$(mktemp "${BEARER_RELEASE_FILE}.XXXXXX")
  trap 'rm -f "$download"' EXIT
  if curl --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-max-time 90 \
    --connect-timeout 10 --max-time 30 \
    --header "Authorization: Bearer $GITHUB_TOKEN" \
    --output "$download" "$BEARER_RELEASE_URL" \
    && release_info "$download" > /dev/null; then
    mv "$download" "$BEARER_RELEASE_FILE"
  elif release_info "$BEARER_RELEASE_FILE" > /dev/null 2>&1; then
    echo "::warning::Bearer release refresh failed; using the last validated cached release"
  else
    echo "Could not resolve a verified Bearer release" >&2
    exit 1
  fi
fi

IFS=$'\t' read -r tag filename checksum < <(release_info "$BEARER_RELEASE_FILE")
echo "Using Bearer ${tag} (${BEARER_PLATFORM})"
{
  echo "archive=$RUNNER_TEMP/bearer-downloads/$filename"
  echo "url=https://github.com/Bearer/bearer/releases/download/${tag}/${filename}"
  echo "checksum=$checksum"
  echo "binary-key=bearer-binary-v1-${BEARER_PLATFORM}-${checksum}"
} >> "$GITHUB_OUTPUT"
