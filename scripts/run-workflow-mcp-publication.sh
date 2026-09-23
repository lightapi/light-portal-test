#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"

export PROMOTION_UI_BASE_URL="${PROMOTION_UI_BASE_URL:-https://localhost:3000}"
export PROMOTION_AUTH_STATE_FILE="${PROMOTION_AUTH_STATE_FILE:-$repo_root/.playwright-auth/workflow-mcp-publication/state.json}"
export PROMOTION_E2E_EMAIL="${WORKFLOW_MCP_E2E_EMAIL:-${PROMOTION_E2E_EMAIL:-steve.hu@lightapi.net}}"
export PROMOTION_E2E_PASSWORD="${WORKFLOW_MCP_E2E_PASSWORD:-${PROMOTION_E2E_PASSWORD:-123456}}"
export PROMOTION_REUSE_AUTH_STATE=false
export PORTAL_AUTO_LOGIN=false
load_test_environment "$repo_root"
export PROMOTION_REUSE_AUTH_STATE=false

export WORKFLOW_MCP_E2E_HOST_ID="${WORKFLOW_MCP_E2E_HOST_ID:-01964b05-552a-7c4b-9184-6857e7f3dc5f}"
export WORKFLOW_MCP_E2E_INSTANCE_ID="${WORKFLOW_MCP_E2E_INSTANCE_ID:-0ac8b305-722b-5c83-99eb-e475ec2bc9ea}"
export WORKFLOW_MCP_E2E_API_VERSION_ID="${WORKFLOW_MCP_E2E_API_VERSION_ID:-019e6231-5aa0-756c-a000-5b493ad49d0a}"
export WORKFLOW_MCP_E2E_INSTANCE_NAME="${WORKFLOW_MCP_E2E_INSTANCE_NAME:-workflow-mcp-e2e-loc}"
export WORKFLOW_MCP_E2E_GATEWAY_URL="${WORKFLOW_MCP_E2E_GATEWAY_URL:-https://localhost:8445}"
export WORKFLOW_MCP_E2E_CONTAINER="${WORKFLOW_MCP_E2E_CONTAINER:-workflow-mcp-test-gateway}"

require_command docker
require_command node
cd "$repo_root"
if [[ -n "${WORKFLOW_MCP_PUBLICATION_GREP:-}" ]]; then
  exec npm run test:workflow-mcp-publication -- --grep "$WORKFLOW_MCP_PUBLICATION_GREP"
fi
exec npm run test:workflow-mcp-publication
