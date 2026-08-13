#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-batch-$$"
report_root="${REPORT_ROOT:-$repo_root/reports/runs/$run_id}"
batch_repeat_count="${BATCH_REPEAT_COUNT:-3}"
batch_repeat_interval="${BATCH_REPEAT_INTERVAL:-5}"

if [[ "$report_root" != /* ]]; then
  report_root="$repo_root/$report_root"
fi
if [[ "$report_root" != "$repo_root"/* ]]; then
  echo "REPORT_ROOT must be inside $repo_root" >&2
  exit 2
fi
mkdir -p "$report_root"

echo "Batch reports: $report_root"
echo "The functional and repeat suites call the configured live LLM provider."
"$repo_root/scripts/validate.sh"

REPORT_DIR="$report_root/functional/hurl" \
  "$repo_root/scripts/run-functional.sh" tests/smoke tests/llm tests/workflow-mcp

COUNT="$batch_repeat_count" \
INTERVAL="$batch_repeat_interval" \
REPORT_ROOT="$report_root" \
  "$repo_root/scripts/run-repeated.sh"

REPORT_DIR="$report_root/performance/models" \
  "$repo_root/scripts/run-performance.sh" models-smoke

if [[ "${ALLOW_BILLABLE_TESTS:-false}" == "true" ]]; then
  REPORT_DIR="$report_root/performance/llm" \
  ALLOW_BILLABLE_TESTS=true \
    "$repo_root/scripts/run-performance.sh" llm-buffered
else
  echo "Skipping billable LLM performance test; set ALLOW_BILLABLE_TESTS=true to include it."
fi

echo "Batch completed successfully. Reports: $report_root"
