#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=promotion-common.sh
source "$repo_root/scripts/promotion-common.sh"

load_promotion_environment "$repo_root"
require_promotion_canary
print_promotion_profile

export PROMOTION_API_BASE_URL PROMOTION_SOURCE_HOST_ID PROMOTION_TARGET_HOST_ID
export PROMOTION_PLATFORM_MATCH PROMOTION_PIPELINE_MATCH PROMOTION_PIPELINE_VERSION
export PROMOTION_PRODUCT_ID PROMOTION_PRODUCT_VERSION
export REPORT_DIR="${REPORT_DIR:-$repo_root/reports/promotion-api}"

LIGHT_PORTAL_ENV_FILE=/dev/null \
  "$repo_root/scripts/run-functional.sh" tests/promotion
