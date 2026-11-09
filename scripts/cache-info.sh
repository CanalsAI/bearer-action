#!/usr/bin/env bash
set -euo pipefail

version="${BEARER_VERSION:-latest}"
version="${version#v}"
if [[ "$version" != latest && ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected latest or a stable Bearer release version" >&2
  exit 1
fi
case "$RUNNER_OS" in
  Linux) os=linux ;;
  macOS) os=darwin ;;
  *) echo "Unsupported runner OS: $RUNNER_OS" >&2; exit 1 ;;
esac
case "$RUNNER_ARCH" in
  X64) arch=amd64 ;;
  ARM64) arch=arm64 ;;
  *) echo "Unsupported runner architecture: $RUNNER_ARCH" >&2; exit 1 ;;
esac

release_ref=latest
[[ "$version" == latest ]] || release_ref="tags/v${version}"
prefix="bearer-release-v1-${os}-${arch}-${version}-"
today=$(date -u +%F)
{
  echo "platform=${os}_${arch}"
  echo "release-file=$RUNNER_TEMP/bearer-downloads/release-${os}-${arch}-${version}.json"
  echo "release-url=https://api.github.com/repos/Bearer/bearer/releases/${release_ref}"
  echo "release-prefix=$prefix"
  echo "release-key=${prefix}${today}"
  echo "rules-directory=${TMPDIR:-/tmp}/bearer-rules"
  echo "rules-prefix=bearer-rules-v1-"
  echo "rules-key=bearer-rules-v1-${today}"
} >> "$GITHUB_OUTPUT"
