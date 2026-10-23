#!/usr/bin/env bash
# Writes a CycloneDX SBOM of a package's locked production dependencies.
#
# Usage: .github/scripts/sbom.sh <package-dir> <output.json>
#
# `npm sbom` needs a root version to build the package URL, and
# functions/package.json has none, so it runs on a temporary copy of the
# manifest and lockfile with the version defaulted to 0.0.0.
#
# `npm sbom` also skips the dependencies of linked workspace packages (such as
# packages/core), so the copy folds each workspace's dependencies into the root
# and drops the workspace links. The locked versions are unchanged.
set -euo pipefail

src=$1
out=$2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

lock="$src/package-lock.json"
# Dependencies of every linked workspace, and the names those workspaces publish.
workspace_deps=$(jq '[.packages as $p | $p | to_entries[]
  | select(.value.link == true) | $p[.value.resolved].dependencies // {}] | add // {}' "$lock")
workspace_names=$(jq '[.packages as $p | $p | to_entries[]
  | select(.value.link == true) | $p[.value.resolved].name]' "$lock")

jq --argjson deps "$workspace_deps" --argjson names "$workspace_names" '
  .version //= "0.0.0"
  | del(.workspaces)
  | .dependencies = ((.dependencies // {}) + $deps | with_entries(select(.key | IN($names[]) | not)))
' "$src/package.json" > "$tmp/package.json"
jq --argjson deps "$workspace_deps" --argjson names "$workspace_names" '
  .version //= "0.0.0"
  | ([.packages | to_entries[] | select(.value.link == true) | .key, .value.resolved]) as $links
  | .packages |= with_entries(select(.key | IN($links[]) | not))
  | .packages[""].version //= "0.0.0"
  | del(.packages[""].workspaces)
  | .packages[""].dependencies = ((.packages[""].dependencies // {}) + $deps
      | with_entries(select(.key | IN($names[]) | not)))
' "$lock" > "$tmp/package-lock.json"
npm sbom --prefix "$tmp" --package-lock-only --omit=dev --sbom-format=cyclonedx > "$out"
echo "$out: $(jq '.components | length' "$out") components"
