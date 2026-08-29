#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=promotion-common.sh
source "$repo_root/scripts/promotion-common.sh"

load_promotion_environment "$repo_root"
require_promotion_canary
print_promotion_profile
require_command node

playwright="$repo_root/node_modules/.bin/playwright"
if [[ ! -x "$playwright" ]]; then
  echo "Playwright is not installed. Run 'npm ci' in $repo_root first." >&2
  exit 2
fi

run_id="${PROMOTION_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
report_root="${PROMOTION_REPORT_ROOT:-$repo_root/reports/runs/$run_id/promotion-ui}"
if [[ "$report_root" != /* ]]; then
  report_root="$repo_root/$report_root"
fi
if [[ "$report_root" != "$repo_root"/* ]]; then
  echo "PROMOTION_REPORT_ROOT must be inside $repo_root" >&2
  exit 2
fi

export PROMOTION_RUN_ID="$run_id"
export PROMOTION_REPORT_ROOT="$report_root"
mkdir -p "$report_root"

exec "$playwright" test tests/promotion-ui --config "$repo_root/playwright.config.js"
