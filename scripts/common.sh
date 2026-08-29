#!/usr/bin/env bash

load_test_environment() {
  local repo_root="${1:?repository root is required}"
  local env_file="${LIGHT_PORTAL_ENV_FILE:-$HOME/.config/lightapi/light-portal.env}"
  local original_portal_base_url="${PORTAL_BASE_URL-}"
  local original_mcp_base_url="${MCP_BASE_URL-}"
  local original_portal_access_token="${PORTAL_ACCESS_TOKEN-}"
  local original_portal_access_token_source="${PORTAL_ACCESS_TOKEN_SOURCE-}"
  local original_llm_public_alias="${LLM_PUBLIC_ALIAS-}"
  local original_tls_insecure="${TLS_INSECURE-}"
  local original_token_profile="${TOKEN_PROFILE-}"
  local original_portal_token_dir="${PORTAL_TOKEN_DIR-}"
  local original_embedding_query_alias="${EMBEDDING_QUERY_ALIAS-}"
  local original_embedding_index_alias="${EMBEDDING_INDEX_ALIAS-}"
  local original_embedding_space_id="${EMBEDDING_SPACE_ID-}"
  local original_embedding_space_revision="${EMBEDDING_SPACE_REVISION-}"
  local original_embedding_dimension="${EMBEDDING_DIMENSION-}"
  local original_embedding_access_token="${EMBEDDING_ACCESS_TOKEN-}"
  local original_embedding_query_access_token="${EMBEDDING_QUERY_ACCESS_TOKEN-}"
  local original_embedding_index_access_token="${EMBEDDING_INDEX_ACCESS_TOKEN-}"
  local original_workflow_smoke_tool="${WORKFLOW_SMOKE_TOOL-}"
  local original_customer_360_tool="${CUSTOMER_360_TOOL-}"
  local original_portal_auto_login="${PORTAL_AUTO_LOGIN-}"
  local original_portal_token_min_ttl_seconds="${PORTAL_TOKEN_MIN_TTL_SECONDS-}"
  local original_promotion_ui_base_url="${PROMOTION_UI_BASE_URL-}"
  local original_promotion_auth_state_file="${PROMOTION_AUTH_STATE_FILE-}"
  local original_promotion_e2e_email="${PROMOTION_E2E_EMAIL-}"
  local original_promotion_e2e_password="${PROMOTION_E2E_PASSWORD-}"
  local original_promotion_e2e_user_type="${PROMOTION_E2E_USER_TYPE-}"

  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi

  [[ -n "$original_portal_base_url" ]] && PORTAL_BASE_URL="$original_portal_base_url"
  [[ -n "$original_mcp_base_url" ]] && MCP_BASE_URL="$original_mcp_base_url"
  [[ -n "$original_portal_access_token" ]] && PORTAL_ACCESS_TOKEN="$original_portal_access_token"
  [[ -n "$original_portal_access_token_source" ]] && PORTAL_ACCESS_TOKEN_SOURCE="$original_portal_access_token_source"
  [[ -n "$original_llm_public_alias" ]] && LLM_PUBLIC_ALIAS="$original_llm_public_alias"
  [[ -n "$original_tls_insecure" ]] && TLS_INSECURE="$original_tls_insecure"
  [[ -n "$original_token_profile" ]] && TOKEN_PROFILE="$original_token_profile"
  [[ -n "$original_portal_token_dir" ]] && PORTAL_TOKEN_DIR="$original_portal_token_dir"
  [[ -n "$original_embedding_query_alias" ]] && EMBEDDING_QUERY_ALIAS="$original_embedding_query_alias"
  [[ -n "$original_embedding_index_alias" ]] && EMBEDDING_INDEX_ALIAS="$original_embedding_index_alias"
  [[ -n "$original_embedding_space_id" ]] && EMBEDDING_SPACE_ID="$original_embedding_space_id"
  [[ -n "$original_embedding_space_revision" ]] && EMBEDDING_SPACE_REVISION="$original_embedding_space_revision"
  [[ -n "$original_embedding_dimension" ]] && EMBEDDING_DIMENSION="$original_embedding_dimension"
  [[ -n "$original_embedding_access_token" ]] && EMBEDDING_ACCESS_TOKEN="$original_embedding_access_token"
  [[ -n "$original_embedding_query_access_token" ]] && EMBEDDING_QUERY_ACCESS_TOKEN="$original_embedding_query_access_token"
  [[ -n "$original_embedding_index_access_token" ]] && EMBEDDING_INDEX_ACCESS_TOKEN="$original_embedding_index_access_token"
  [[ -n "$original_workflow_smoke_tool" ]] && WORKFLOW_SMOKE_TOOL="$original_workflow_smoke_tool"
  [[ -n "$original_customer_360_tool" ]] && CUSTOMER_360_TOOL="$original_customer_360_tool"
  [[ -n "$original_portal_auto_login" ]] && PORTAL_AUTO_LOGIN="$original_portal_auto_login"
  [[ -n "$original_portal_token_min_ttl_seconds" ]] && PORTAL_TOKEN_MIN_TTL_SECONDS="$original_portal_token_min_ttl_seconds"
  [[ -n "$original_promotion_ui_base_url" ]] && PROMOTION_UI_BASE_URL="$original_promotion_ui_base_url"
  [[ -n "$original_promotion_auth_state_file" ]] && PROMOTION_AUTH_STATE_FILE="$original_promotion_auth_state_file"
  [[ -n "$original_promotion_e2e_email" ]] && PROMOTION_E2E_EMAIL="$original_promotion_e2e_email"
  [[ -n "$original_promotion_e2e_password" ]] && PROMOTION_E2E_PASSWORD="$original_promotion_e2e_password"
  [[ -n "$original_promotion_e2e_user_type" ]] && PROMOTION_E2E_USER_TYPE="$original_promotion_e2e_user_type"

  PORTAL_BASE_URL="${PORTAL_BASE_URL:-https://localhost:8444}"
  MCP_BASE_URL="${MCP_BASE_URL:-https://localhost}"
  LLM_PUBLIC_ALIAS="${LLM_PUBLIC_ALIAS:-assistant-dev}"
  WORKFLOW_SMOKE_TOOL="${WORKFLOW_SMOKE_TOOL:-workflow_mcp_smoke}"
  CUSTOMER_360_TOOL="${CUSTOMER_360_TOOL:-customer_360}"
  TLS_INSECURE="${TLS_INSECURE:-true}"
  PORTAL_AUTO_LOGIN="${PORTAL_AUTO_LOGIN:-auto}"
  PORTAL_TOKEN_MIN_TTL_SECONDS="${PORTAL_TOKEN_MIN_TTL_SECONDS:-300}"

  case "$PORTAL_AUTO_LOGIN" in
    auto)
      if [[ -n "${PROMOTION_E2E_EMAIL:-}" && -n "${PROMOTION_E2E_PASSWORD:-}" ]]; then
        require_command node
        PORTAL_ACCESS_TOKEN="$(node "$repo_root/runner/refresh-portal-token.mjs")"
        PORTAL_ACCESS_TOKEN_SOURCE="ui-login"
        TOKEN_PROFILE="ui-login"
      fi
      ;;
    true|1)
      require_command node
      PORTAL_ACCESS_TOKEN="$(node "$repo_root/runner/refresh-portal-token.mjs")"
      PORTAL_ACCESS_TOKEN_SOURCE="ui-login"
      TOKEN_PROFILE="ui-login"
      ;;
    false|0)
      ;;
    *)
      echo "PORTAL_AUTO_LOGIN must be auto, true, or false" >&2
      return 2
      ;;
  esac

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
    PORTAL_ACCESS_TOKEN_SOURCE="fixture"
  else
    TOKEN_PROFILE="${TOKEN_PROFILE:-environment}"
    PORTAL_ACCESS_TOKEN_SOURCE="${PORTAL_ACCESS_TOKEN_SOURCE:-environment}"
  fi

  require_value PORTAL_ACCESS_TOKEN
  require_value LLM_PUBLIC_ALIAS
  export PORTAL_BASE_URL MCP_BASE_URL PORTAL_ACCESS_TOKEN PORTAL_ACCESS_TOKEN_SOURCE
  export LLM_PUBLIC_ALIAS TLS_INSECURE TOKEN_PROFILE
  export WORKFLOW_SMOKE_TOOL CUSTOMER_360_TOOL
  export PORTAL_AUTO_LOGIN PORTAL_TOKEN_MIN_TTL_SECONDS
}

require_current_access_token() {
  local token="${PORTAL_ACCESS_TOKEN:?PORTAL_ACCESS_TOKEN is required}"
  local payload
  payload="$(printf '%s' "$token" | cut -d. -f2)"
  if [[ -z "$payload" || "$payload" == "$token" ]]; then
    return
  fi

  local remainder=$(( ${#payload} % 4 ))
  case "$remainder" in
    0) ;;
    2) payload+='==' ;;
    3) payload+='=' ;;
    *) return ;;
  esac
  local claims
  claims="$(printf '%s' "$payload" | tr '_-' '/+' | base64 -d 2>/dev/null)" || return
  local expires_at
  expires_at="$(jq -er '.exp // empty' <<<"$claims" 2>/dev/null)" || return
  if (( expires_at <= $(date +%s) )); then
    echo "PORTAL_ACCESS_TOKEN expired at $(date -u -d "@$expires_at" '+%Y-%m-%dT%H:%M:%SZ'). Configure UI credentials or supply a current token." >&2
    return 2
  fi
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
