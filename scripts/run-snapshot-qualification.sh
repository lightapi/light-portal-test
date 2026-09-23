#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Load shared settings without triggering its optional remote UI login. This
# qualification's public development credentials are used only with localhost.
umask 077
export PORTAL_AUTO_LOGIN=false
export PORTAL_TOKEN_MIN_TTL_SECONDS=1920
source "$repo_root/scripts/common.sh"
load_test_environment "$repo_root"
export SNAPSHOT_LOCAL_LOGIN=false
if [[ -z "${PORTAL_ACCESS_TOKEN_FILE:-}" && "${SNAPSHOT_AUTO_LOGIN:-true}" == "true" ]]; then
  export PROMOTION_UI_BASE_URL=https://localhost:3000
  export PROMOTION_AUTH_STATE_FILE="$repo_root/.playwright-auth/snapshot-local/state.json"
  export PROMOTION_E2E_EMAIL="${SNAPSHOT_E2E_EMAIL:-steve.hu@lightapi.net}"
  export PROMOTION_E2E_PASSWORD="${SNAPSHOT_E2E_PASSWORD:-123456}"
  export PORTAL_TOKEN_MIN_TTL_SECONDS=120
  export SNAPSHOT_LOCAL_LOGIN=true
fi
exec node "$repo_root/scripts/run-snapshot-qualification.mjs" "$@"
