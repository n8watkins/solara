#!/usr/bin/env bash
# Writes a CycloneDX SBOM of a package's locked production dependencies.
#
# Usage: .github/scripts/sbom.sh <package-dir> <output.json>
#
# `npm sbom` needs a root version to build the package URL, and
# functions/package.json has none, so it runs on a temporary copy of the
# manifest and lockfile with the version defaulted to 0.0.0.
set -euo pipefail

src=$1
out=$2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

jq '.version //= "0.0.0"' "$src/package.json" > "$tmp/package.json"
jq '.version //= "0.0.0" | .packages[""].version //= "0.0.0"' \
  "$src/package-lock.json" > "$tmp/package-lock.json"
npm sbom --prefix "$tmp" --package-lock-only --omit=dev --sbom-format=cyclonedx > "$out"
echo "$out: $(jq '.components | length' "$out") components"
