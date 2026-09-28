#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
names=(RULE_E2E_BASE_URL RULE_E2E_AUTH_STATE_FILE RULE_E2E_EMAIL
       RULE_E2E_PASSWORD RULE_E2E_USER_TYPE RULE_E2E_HOST_ID RULE_E2E_RULE_ID
       RULE_E2E_TEST_ID TLS_INSECURE)
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

export RULE_E2E_BASE_URL="${RULE_E2E_BASE_URL:-${WORKFLOW_UI_BASE_URL:-${PROMOTION_UI_BASE_URL:-https://localhost:3000}}}"
export RULE_E2E_EMAIL="${RULE_E2E_EMAIL:-${WORKFLOW_E2E_EMAIL:-${PROMOTION_E2E_EMAIL:-}}}"
export RULE_E2E_PASSWORD="${RULE_E2E_PASSWORD:-${WORKFLOW_E2E_PASSWORD:-${PROMOTION_E2E_PASSWORD:-}}}"
export RULE_E2E_USER_TYPE="${RULE_E2E_USER_TYPE:-${WORKFLOW_E2E_USER_TYPE:-${PROMOTION_E2E_USER_TYPE:-}}}"
export RULE_E2E_AUTH_STATE_FILE RULE_E2E_HOST_ID RULE_E2E_RULE_ID RULE_E2E_TEST_ID TLS_INSECURE

if [[ -n "${RULE_E2E_RULE_ID:-}" && -z "${RULE_E2E_TEST_ID:-}" ]] ||
   [[ -z "${RULE_E2E_RULE_ID:-}" && -n "${RULE_E2E_TEST_ID:-}" ]]; then
  echo 'Set both RULE_E2E_RULE_ID and RULE_E2E_TEST_ID, or leave both unset for automatic fixture setup.' >&2
  exit 2
fi

playwright="$repo_root/node_modules/.bin/playwright"
if [[ ! -x "$playwright" ]]; then
  echo "Playwright is not installed. Run 'npm ci' in $repo_root first." >&2
  exit 2
fi
cd "$repo_root"
exec "$playwright" test --config playwright.rule-execution.config.js "$@"
