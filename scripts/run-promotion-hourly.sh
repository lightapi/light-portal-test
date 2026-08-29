#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=promotion-common.sh
source "$repo_root/scripts/promotion-common.sh"

load_promotion_environment "$repo_root"
require_promotion_canary

run_id="${PROMOTION_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
report_root="${PROMOTION_REPORT_ROOT:-$repo_root/reports/runs/$run_id}"

export PROMOTION_RUN_ID="$run_id"
case "$PROMOTION_API_PREFLIGHT" in
  auto)
    if [[ "$PORTAL_ACCESS_TOKEN_SOURCE" == "environment" ]]; then
      REPORT_DIR="$report_root/promotion-api" "$repo_root/scripts/run-promotion-api.sh"
    else
      echo "Skipping optional Hurl promotion preflight: no explicit PORTAL_ACCESS_TOKEN is configured."
    fi
    ;;
  true|1|required)
    REPORT_DIR="$report_root/promotion-api" "$repo_root/scripts/run-promotion-api.sh"
    ;;
  false|0|skip)
    echo "Skipping optional Hurl promotion preflight: PROMOTION_API_PREFLIGHT=$PROMOTION_API_PREFLIGHT."
    ;;
  *)
    echo "PROMOTION_API_PREFLIGHT must be auto, required, or skip" >&2
    exit 2
    ;;
esac
PROMOTION_REPORT_ROOT="$report_root/promotion-ui" "$repo_root/scripts/run-promotion-ui.sh"

echo "Promotion hourly suite completed: $report_root"
