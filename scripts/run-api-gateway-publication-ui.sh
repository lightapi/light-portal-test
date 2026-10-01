#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
names=(API_GATEWAY_E2E_BASE_URL API_GATEWAY_E2E_AUTH_STATE_FILE API_GATEWAY_E2E_EMAIL
       API_GATEWAY_E2E_PASSWORD API_GATEWAY_E2E_USER_TYPE API_GATEWAY_E2E_HOST_ID
       API_GATEWAY_E2E_INSTANCE_NAME API_GATEWAY_E2E_API_ID API_GATEWAY_E2E_RULE_ID
       API_GATEWAY_E2E_ROLE_ID API_GATEWAY_E2E_REPORT_ROOT TLS_INSECURE)
declare -A supplied=()
for name in "${names[@]}"; do
  if [[ -v $name ]]; then supplied["$name"]="${!name}"; fi
done
env_file="${LIGHT_PORTAL_ENV_FILE:-$HOME/.config/lightapi/light-portal.env}"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi
for name in "${!supplied[@]}"; do printf -v "$name" '%s' "${supplied[$name]}"; done
export PROMOTION_E2E_EMAIL="${API_GATEWAY_E2E_EMAIL:-${PROMOTION_E2E_EMAIL:-}}"
export PROMOTION_E2E_PASSWORD="${API_GATEWAY_E2E_PASSWORD:-${PROMOTION_E2E_PASSWORD:-}}"
export PROMOTION_E2E_USER_TYPE="${API_GATEWAY_E2E_USER_TYPE:-${PROMOTION_E2E_USER_TYPE:-}}"
export PROMOTION_REUSE_AUTH_STATE=true
for name in "${names[@]}"; do export "$name"; done
cd "$repo_root"
exec ./node_modules/.bin/playwright test --config playwright.api-gateway-publication.config.js "$@"
