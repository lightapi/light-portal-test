#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

for name in WORKFLOW_TOOL_E2E_HOST_ID WORKFLOW_TOOL_E2E_INSTANCE_NAME \
  WORKFLOW_TOOL_E2E_TOOL_NAME WORKFLOW_TOOL_E2E_GATEWAY_URL \
  WORKFLOW_TOOL_E2E_CONTAINER WORKFLOW_TOOL_E2E_REQUEST_RULE; do
  [[ -n "${!name:-}" ]] || { echo "$name is required" >&2; exit 2; }
done

export WORKFLOW_TOOL_E2E_ENABLED=true
export WORKFLOW_MCP_PUBLICATION_GREP="unpublishes and republishes one explicitly configured workflow Tool"
exec bash "$repo_root/scripts/run-workflow-mcp-publication.sh"
