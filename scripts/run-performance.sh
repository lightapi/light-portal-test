#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=common.sh
source "$repo_root/scripts/common.sh"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <models-smoke|llm-buffered>" >&2
  exit 2
fi

profile="$1"
case "$profile" in
  models-smoke)
    script="$repo_root/performance/models-smoke.js"
    ;;
  llm-buffered)
    if [[ "${ALLOW_BILLABLE_TESTS:-false}" != "true" ]]; then
      echo "llm-buffered can incur provider charges; set ALLOW_BILLABLE_TESTS=true" >&2
      exit 2
    fi
    script="$repo_root/performance/llm-buffered.js"
    ;;
  *)
    echo "unknown performance profile: $profile" >&2
    exit 2
    ;;
esac

load_test_environment "$repo_root"
print_token_profile
report_dir="${REPORT_DIR:-$repo_root/reports/k6}"
if [[ "$report_dir" != /* ]]; then
  report_dir="$repo_root/$report_dir"
fi
if [[ "$report_dir" != "$repo_root"/* ]]; then
  echo "REPORT_DIR must be inside $repo_root for container compatibility" >&2
  exit 2
fi
container_report_dir="/work/${report_dir#"$repo_root"/}"
mkdir -p "$report_dir"

export BASE_URL="$PORTAL_BASE_URL"
export ACCESS_TOKEN="$PORTAL_ACCESS_TOKEN"
export LLM_MODEL="$LLM_PUBLIC_ALIAS"
export VUS="${VUS:-1}"
export DURATION="${DURATION:-30s}"
export K6_INSECURE_SKIP_TLS_VERIFY="$TLS_INSECURE"

if command -v k6 >/dev/null 2>&1; then
  exec k6 run --summary-export "$report_dir/$profile-summary.json" "$script"
fi

engine="$(find_container_engine)" || {
  echo "k6 is not installed and neither podman nor docker was found" >&2
  exit 2
}
image="${K6_IMAGE:-grafana/k6:2.0.0}"
container_args=(
  run --rm --network host
  --workdir /work
  --env BASE_URL
  --env ACCESS_TOKEN
  --env LLM_MODEL
  --env VUS
  --env DURATION
  --env K6_INSECURE_SKIP_TLS_VERIFY
)
if [[ "$engine" == podman ]]; then
  container_args+=(--userns keep-id --volume "$repo_root:/work:Z")
else
  container_args+=(--user "$(id -u):$(id -g)" --volume "$repo_root:/work")
fi

exec "$engine" "${container_args[@]}" "$image" run \
  --summary-export "$container_report_dir/$profile-summary.json" \
  "/work/${script#"$repo_root"/}"
