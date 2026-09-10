#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"
load_test_environment "$repo_root"
require_current_access_token
require_command node
print_token_profile
report_dir="${REPORT_DIR:-$repo_root/reports/mcp}"
[[ "$report_dir" = /* ]] || report_dir="$repo_root/$report_dir"
report_dir="$(realpath -m "$report_dir")"
if [[ "$report_dir" != "$repo_root/reports/"* ]]; then
  echo "MCP REPORT_DIR must be inside $repo_root/reports" >&2
  exit 2
fi
export REPORT_DIR="$report_dir"
exec node "$repo_root/tests/mcp/live.mjs"
