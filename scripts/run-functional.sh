#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"

load_test_environment "$repo_root"
print_token_profile

if [[ $# -eq 0 ]]; then
  set -- tests/smoke tests/llm tests/workflow-mcp
fi

inputs=()
container_inputs=()
for input in "$@"; do
  if [[ "$input" = /* ]]; then
    inputs+=("$input")
    if [[ "$input" != "$repo_root"/* ]]; then
      echo "container mode only supports test paths inside $repo_root" >&2
      exit 2
    fi
    container_inputs+=("/work/${input#"$repo_root"/}")
  else
    inputs+=("$repo_root/$input")
    container_inputs+=("/work/$input")
  fi
done

report_dir="${REPORT_DIR:-$repo_root/reports/hurl}"
if [[ "$report_dir" != /* ]]; then
  report_dir="$repo_root/$report_dir"
fi
if [[ "$report_dir" != "$repo_root"/* ]]; then
  echo "REPORT_DIR must be inside $repo_root for container compatibility" >&2
  exit 2
fi
container_report_dir="/work/${report_dir#"$repo_root"/}"
mkdir -p "$report_dir/json"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
export HURL_SECRET_access_token="$PORTAL_ACCESS_TOKEN"
export HURL_SECRET_embedding_query_access_token="${EMBEDDING_QUERY_ACCESS_TOKEN:-$PORTAL_ACCESS_TOKEN}"
export HURL_SECRET_embedding_index_access_token="${EMBEDDING_INDEX_ACCESS_TOKEN:-$PORTAL_ACCESS_TOKEN}"
args=(
  --test
  --jobs 1
  --connect-timeout 10s
  --max-time 60s
  --variable "base_url=$PORTAL_BASE_URL"
  --variable "mcp_base_url=$MCP_BASE_URL"
  --variable "llm_model=$LLM_PUBLIC_ALIAS"
  --variable "embedding_query_alias=${EMBEDDING_QUERY_ALIAS:-kb-query}"
  --variable "embedding_index_alias=${EMBEDDING_INDEX_ALIAS:-kb-index}"
  --variable "embedding_space_id=${EMBEDDING_SPACE_ID:-nvidia-nemotron-3-embed-1b-float-v1}"
  --variable "embedding_space_revision=${EMBEDDING_SPACE_REVISION:-1}"
  --variable "embedding_dimension=${EMBEDDING_DIMENSION:-2048}"
  --variable "workflow_smoke_tool=$WORKFLOW_SMOKE_TOOL"
  --variable "customer_360_tool=$CUSTOMER_360_TOOL"
  --variable "run_id=$run_id"
)
if tls_is_insecure; then
  args+=(--insecure)
fi

if command -v hurl >/dev/null 2>&1; then
  exec hurl "${args[@]}" \
    --report-json "$report_dir/json" \
    --report-junit "$report_dir/junit.xml" \
    "${inputs[@]}"
fi

engine="$(find_container_engine)" || {
  echo "hurl is not installed and neither podman nor docker was found" >&2
  exit 2
}
image="${HURL_IMAGE:-ghcr.io/orange-opensource/hurl:8.0.1}"
container_args=(
  run --rm --network host
  --workdir /work
  --env HURL_SECRET_access_token
  --env HURL_SECRET_embedding_query_access_token
  --env HURL_SECRET_embedding_index_access_token
)
if [[ "$engine" == podman ]]; then
  container_args+=(--userns keep-id --volume "$repo_root:/work:Z")
else
  container_args+=(--user "$(id -u):$(id -g)" --volume "$repo_root:/work")
fi

exec "$engine" "${container_args[@]}" "$image" \
  "${args[@]}" \
  --report-json "$container_report_dir/json" \
  --report-junit "$container_report_dir/junit.xml" \
  "${container_inputs[@]}"
