#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# Fixture names and their configuration live beside the tests that need them.
names=()
for input in "$@"; do
  case "${input##*/}" in
    workflow-smoke.hurl) names+=("${WORKFLOW_SMOKE_TOOL:-workflow_mcp_smoke}") ;;
    customer-360.hurl) names+=("${CUSTOMER_360_TOOL:-customer_360}") ;;
  esac
done
if (( ${#names[@]} )); then
  command -v node >/dev/null || { echo "Workflow fixture setup requires Node.js and npm ci." >&2; exit 2; }
  exec node "$repo_root/runner/prepare-workflow-fixtures.mjs" "${names[@]}"
fi
