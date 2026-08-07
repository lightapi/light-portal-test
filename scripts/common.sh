#!/usr/bin/env bash

load_test_environment() {
  local repo_root="${1:?repository root is required}"
  local env_file="${LIGHT_PORTAL_ENV_FILE:-$HOME/.config/lightapi/light-portal.env}"
  local original_portal_base_url="${PORTAL_BASE_URL-}"
  local original_portal_access_token="${PORTAL_ACCESS_TOKEN-}"
  local original_llm_public_alias="${LLM_PUBLIC_ALIAS-}"
  local original_tls_insecure="${TLS_INSECURE-}"
  local original_token_profile="${TOKEN_PROFILE-}"
  local original_portal_token_dir="${PORTAL_TOKEN_DIR-}"

  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi

  [[ -n "$original_portal_base_url" ]] && PORTAL_BASE_URL="$original_portal_base_url"
  [[ -n "$original_portal_access_token" ]] && PORTAL_ACCESS_TOKEN="$original_portal_access_token"
  [[ -n "$original_llm_public_alias" ]] && LLM_PUBLIC_ALIAS="$original_llm_public_alias"
  [[ -n "$original_tls_insecure" ]] && TLS_INSECURE="$original_tls_insecure"
  [[ -n "$original_token_profile" ]] && TOKEN_PROFILE="$original_token_profile"
  [[ -n "$original_portal_token_dir" ]] && PORTAL_TOKEN_DIR="$original_portal_token_dir"

  PORTAL_BASE_URL="${PORTAL_BASE_URL:-https://localhost:8444}"
  LLM_PUBLIC_ALIAS="${LLM_PUBLIC_ALIAS:-assistant-dev}"
  TLS_INSECURE="${TLS_INSECURE:-true}"

  if [[ -z "${PORTAL_ACCESS_TOKEN:-}" ]]; then
    require_command jq
    local manifest="$repo_root/fixtures/tokens/manifest.json"
    TOKEN_PROFILE="${TOKEN_PROFILE:-$(jq -er '.defaultProfile' "$manifest")}"
    if [[ ! "$TOKEN_PROFILE" =~ ^[a-z0-9][a-z0-9._-]*$ ]]; then
      echo "TOKEN_PROFILE contains unsupported characters: $TOKEN_PROFILE" >&2
      return 2
    fi
    local token_file_name
    token_file_name="$(jq -er --arg profile "$TOKEN_PROFILE" '.profiles[$profile].file' "$manifest")" || {
      echo "unknown TOKEN_PROFILE: $TOKEN_PROFILE" >&2
      return 2
    }
    PORTAL_TOKEN_DIR="${PORTAL_TOKEN_DIR:-$repo_root/fixtures/tokens}"
    local token_file="$PORTAL_TOKEN_DIR/$token_file_name"
    if [[ ! -f "$token_file" ]]; then
      echo "token fixture not found: $token_file" >&2
      return 2
    fi
    PORTAL_ACCESS_TOKEN="$(tr -d '\r\n' <"$token_file")"
  else
    TOKEN_PROFILE="${TOKEN_PROFILE:-environment}"
  fi

  require_value PORTAL_ACCESS_TOKEN
  require_value LLM_PUBLIC_ALIAS
  export PORTAL_BASE_URL PORTAL_ACCESS_TOKEN LLM_PUBLIC_ALIAS TLS_INSECURE TOKEN_PROFILE
}

print_token_profile() {
  local fingerprint
  fingerprint="$(printf '%s' "$PORTAL_ACCESS_TOKEN" | sha256sum | cut -c1-12)"
  echo "tokenProfile=$TOKEN_PROFILE tokenFingerprint=$fingerprint model=$LLM_PUBLIC_ALIAS"
}

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    return 2
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$name is required but was not found in PATH" >&2
    return 2
  fi
}

find_container_engine() {
  if [[ -n "${CONTAINER_ENGINE:-}" ]]; then
    require_command "$CONTAINER_ENGINE"
    printf '%s\n' "$CONTAINER_ENGINE"
    return
  fi
  if command -v podman >/dev/null 2>&1; then
    printf '%s\n' podman
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    printf '%s\n' docker
    return
  fi
  return 1
}

tls_is_insecure() {
  [[ "$TLS_INSECURE" == "true" || "$TLS_INSECURE" == "1" ]]
}
