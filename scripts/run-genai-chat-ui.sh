#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Preserve explicit overrides when loading the same private environment file
# used by the other suites. Browser login does not require API token refresh.
names=(CHAT_UI_BASE_URL CHAT_AGENT_LABEL CHAT_AUTH_STATE_FILE CHAT_SESSION_FILE
       CHAT_E2E_EMAIL CHAT_E2E_PASSWORD TLS_INSECURE)
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
export CHAT_UI_BASE_URL="${CHAT_UI_BASE_URL:-${PROMOTION_UI_BASE_URL:-https://localhost:3000}}"
export CHAT_E2E_EMAIL="${CHAT_E2E_EMAIL:-${PROMOTION_E2E_EMAIL:-}}"
export CHAT_E2E_PASSWORD="${CHAT_E2E_PASSWORD:-${PROMOTION_E2E_PASSWORD:-}}"
export CHAT_AGENT_LABEL CHAT_AUTH_STATE_FILE CHAT_SESSION_FILE TLS_INSECURE
playwright="$repo_root/node_modules/.bin/playwright"
if [[ ! -x "$playwright" ]]; then
  echo "Playwright is not installed. Run 'npm ci' in $repo_root first." >&2
  exit 2
fi
cd "$repo_root"
exec "$playwright" test --config playwright.chat.config.js "$@"
