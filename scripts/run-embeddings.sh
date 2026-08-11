#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"

if [[ "${ALLOW_BILLABLE_TESTS:-false}" != "true" ]]; then
  echo "embedding tests call the live provider; set ALLOW_BILLABLE_TESTS=true" >&2
  exit 2
fi

load_test_environment "$repo_root"
EMBEDDING_QUERY_ACCESS_TOKEN="${EMBEDDING_QUERY_ACCESS_TOKEN:-${EMBEDDING_ACCESS_TOKEN:-$PORTAL_ACCESS_TOKEN}}"
EMBEDDING_INDEX_ACCESS_TOKEN="${EMBEDDING_INDEX_ACCESS_TOKEN:-${EMBEDDING_ACCESS_TOKEN:-$PORTAL_ACCESS_TOKEN}}"
export EMBEDDING_QUERY_ACCESS_TOKEN EMBEDDING_INDEX_ACCESS_TOKEN

REPORT_DIR="${REPORT_DIR:-$repo_root/reports/embeddings}" \
  "$repo_root/scripts/run-functional.sh" tests/embeddings
