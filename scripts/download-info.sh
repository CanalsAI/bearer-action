#!/usr/bin/env bash
set -euo pipefail

release_info() {
  local cutoff
  cutoff=$(($(date -u +%s) - 8 * 24 * 60 * 60))
  jq -er --arg platform "$BEARER_PLATFORM" --argjson cutoff "$cutoff" '
    [
      (if type == "array" then .[] else . end) |
      select(.draft == false and .prerelease == false) |
      select(.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) |
      select((.published_at | fromdateiso8601) <= $cutoff) |
      . as $release |
      .assets[] |
      select(.name == "bearer_" + ($release.tag_name | ltrimstr("v")) + "_" + $platform + ".tar.gz") |
      select((.digest // "") | test("^sha256:[a-f0-9]{64}$")) |
      select((.created_at | fromdateiso8601) <= $cutoff) |
      {
        tag: $release.tag_name,
        name: .name,
        checksum: (.digest | ltrimstr("sha256:")),
        version: ($release.tag_name | ltrimstr("v") | split(".") | map(tonumber))
      }
    ] | sort_by(.version) | last // error("No verified stable Bearer release is at least eight days old") |
    [.tag, .name, .checksum] | @tsv
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
