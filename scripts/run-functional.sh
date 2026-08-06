#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"

load_test_environment "$repo_root"
print_token_profile

if [[ $# -eq 0 ]]; then
  set -- tests/smoke tests/llm
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

mkdir -p "$repo_root/reports/hurl"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
export HURL_SECRET_access_token="$PORTAL_ACCESS_TOKEN"
args=(
  --test
  --jobs 1
  --connect-timeout 10s
  --max-time 60s
  --variable "base_url=$PORTAL_BASE_URL"
  --variable "llm_model=$LLM_PUBLIC_ALIAS"
  --variable "run_id=$run_id"
)
if tls_is_insecure; then
  args+=(--insecure)
fi

if command -v hurl >/dev/null 2>&1; then
  exec hurl "${args[@]}" \
    --report-junit "$repo_root/reports/hurl/junit.xml" \
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
)
if [[ "$engine" == podman ]]; then
  container_args+=(--userns keep-id --volume "$repo_root:/work:Z")
else
  container_args+=(--user "$(id -u):$(id -g)" --volume "$repo_root:/work")
fi

exec "$engine" "${container_args[@]}" "$image" \
  "${args[@]}" \
  --report-junit /work/reports/hurl/junit.xml \
  "${container_inputs[@]}"
