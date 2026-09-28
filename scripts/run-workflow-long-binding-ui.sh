#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
names=(WORKFLOW_LONG_UI_BASE_URL WORKFLOW_LONG_AUTH_STATE_FILE WORKFLOW_LONG_E2E_EMAIL
       WORKFLOW_LONG_E2E_PASSWORD WORKFLOW_LONG_E2E_USER_TYPE WORKFLOW_LONG_HOST_ID
       WORKFLOW_LONG_CLIENT_ID WORKFLOW_LONG_CLIENT_SECRET WORKFLOW_LONG_SOURCE_TOKEN
       WORKFLOW_LONG_PROVIDER_ID WORKFLOW_LONG_ISSUER_BASE_URL TLS_INSECURE)
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
for name in "${!supplied[@]}"; do
  printf -v "$name" '%s' "${supplied[$name]}"
done

export WORKFLOW_LONG_UI_BASE_URL="${WORKFLOW_LONG_UI_BASE_URL:-${WORKFLOW_UI_BASE_URL:-${PROMOTION_UI_BASE_URL:-https://localhost:3000}}}"
export WORKFLOW_LONG_AUTH_STATE_FILE="${WORKFLOW_LONG_AUTH_STATE_FILE:-${WORKFLOW_AUTH_STATE_FILE:-}}"
export WORKFLOW_LONG_E2E_EMAIL="${WORKFLOW_LONG_E2E_EMAIL:-${WORKFLOW_E2E_EMAIL:-${PROMOTION_E2E_EMAIL:-}}}"
export WORKFLOW_LONG_E2E_PASSWORD="${WORKFLOW_LONG_E2E_PASSWORD:-${WORKFLOW_E2E_PASSWORD:-${PROMOTION_E2E_PASSWORD:-}}}"
export WORKFLOW_LONG_E2E_USER_TYPE="${WORKFLOW_LONG_E2E_USER_TYPE:-${WORKFLOW_E2E_USER_TYPE:-${PROMOTION_E2E_USER_TYPE:-}}}"
export WORKFLOW_LONG_HOST_ID WORKFLOW_LONG_CLIENT_ID WORKFLOW_LONG_CLIENT_SECRET
export WORKFLOW_LONG_SOURCE_TOKEN WORKFLOW_LONG_PROVIDER_ID WORKFLOW_LONG_ISSUER_BASE_URL TLS_INSECURE

playwright="$repo_root/node_modules/.bin/playwright"
if [[ ! -x "$playwright" ]]; then
  echo "Playwright is not installed. Run 'npm ci' in $repo_root first." >&2
  exit 2
fi
cd "$repo_root"
exec "$playwright" test --config playwright.workflow-long-binding.config.js "$@"
