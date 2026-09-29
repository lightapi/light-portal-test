#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"

load_test_environment "$repo_root"
require_current_access_token
print_token_profile

if [[ $# -eq 0 ]]; then
  set -- tests/smoke tests/llm tests/workflow-mcp
fi

inputs=()
for input in "$@"; do
  [[ "$input" = /* ]] || input="$repo_root/$input"
  input="$(realpath -e -- "$input")"
  if [[ "$input" != "$repo_root"/* ]]; then
    echo "test paths must be inside $repo_root" >&2
    exit 2
  fi
  if [[ -d "$input" ]]; then
    while IFS= read -r -d '' file; do inputs+=("$file"); done < <(find "$input" -type f -name '*.hurl' -print0 | sort -z)
  elif [[ "$input" == *.hurl ]]; then
    inputs+=("$input")
  else
    echo "expected a Hurl file or test directory: $input" >&2
    exit 2
  fi
done
if (( ${#inputs[@]} == 0 )); then
  echo "no Hurl tests selected" >&2
  exit 2
fi

report_dir="${REPORT_DIR:-$repo_root/reports/hurl}"
if [[ "$report_dir" != /* ]]; then
  report_dir="$repo_root/$report_dir"
fi
report_dir="$(realpath -m -- "$report_dir")"
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
  --variable "promotion_api_base_url=${PROMOTION_API_BASE_URL:-$PORTAL_BASE_URL}"
  --variable "promotion_source_host_id=${PROMOTION_SOURCE_HOST_ID:-}"
  --variable "promotion_target_host_id=${PROMOTION_TARGET_HOST_ID:-}"
  --variable "promotion_platform_match=${PROMOTION_PLATFORM_MATCH:-}"
  --variable "promotion_pipeline_match=${PROMOTION_PIPELINE_MATCH:-}"
  --variable "promotion_product_id=${PROMOTION_PRODUCT_ID:-}"
  --variable "promotion_product_version=${PROMOTION_PRODUCT_VERSION:-}"
  --variable "run_id=$run_id"
)
if tls_is_insecure; then
  args+=(--insecure)
fi

# Validate the execution backend before any fixture hook can mutate a target.
engine=""
if ! command -v hurl >/dev/null 2>&1; then
  engine="$(find_container_engine)" || {
    echo "hurl is not installed and neither podman nor docker was found" >&2
    exit 2
  }
fi
image="${HURL_IMAGE:-ghcr.io/orange-opensource/hurl:8.0.1}"
container_args=(run --rm --network host --workdir /work
  --env HURL_SECRET_access_token --env HURL_SECRET_embedding_query_access_token
  --env HURL_SECRET_embedding_index_access_token)
if [[ "$engine" == podman ]]; then
  container_args+=(--userns keep-id --volume "$repo_root:/work:Z")
else
  container_args+=(--user "$(id -u):$(id -g)" --volume "$repo_root:/work")
fi

# Optional per-directory preparation belongs to the tests, not this runner.
# Run ordinary files first; a failed hook is recorded and only blocks its group.
hooks=("")
declare -A known_hooks=()
for file in "${inputs[@]}"; do
  hook="${file%/*}/prepare.sh"
  if [[ -f "$hook" && ! -v known_hooks["$hook"] ]]; then
    hooks+=("$hook")
    known_hooks["$hook"]=1
  fi
done
status=0
for index in "${!hooks[@]}"; do
  hook="${hooks[$index]}"
  group=()
  container_inputs=()
  for file in "${inputs[@]}"; do
    file_hook="${file%/*}/prepare.sh"
    [[ -f "$file_hook" ]] || file_hook=""
    if [[ "$file_hook" == "$hook" ]]; then
      group+=("$file")
      container_inputs+=("/work/${file#"$repo_root"/}")
    fi
  done
  (( ${#group[@]} )) || continue
  if [[ -n "$hook" ]]; then
    setup_log="$report_dir/prepare-$index.log"
    if ! bash "$hook" "${group[@]}" >"$setup_log" 2>&1; then
      cat "$setup_log" >&2
      # Keep error text out of XML attributes. Details are in the adjacent log.
      printf '%s\n' '<testsuites><testsuite name="fixture preparation" tests="1" failures="1" errors="0" skipped="0"><testcase name="prepare"><failure message="Fixture preparation failed; see adjacent prepare log"/></testcase></testsuite></testsuites>' >"$report_dir/prepare-$index.xml"
      status=1
      continue
    fi
    cat "$setup_log"
    rm -f -- "$report_dir/prepare-$index.xml"
  fi
  if [[ -z "$engine" ]]; then
    hurl "${args[@]}" --report-json "$report_dir/json" --report-junit "$report_dir/junit.xml" "${group[@]}" || status=1
  else
    "$engine" "${container_args[@]}" "$image" "${args[@]}" \
      --report-json "$container_report_dir/json" --report-junit "$container_report_dir/junit.xml" \
      "${container_inputs[@]}" || status=1
  fi
done
exit "$status"
