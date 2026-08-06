#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
count="${COUNT:-10}"
interval="${INTERVAL:-10}"
stop_on_failure="${STOP_ON_FAILURE:-true}"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-repeat-$$"
report_root="${REPORT_ROOT:-$repo_root/reports/runs/$run_id}"

if [[ ! "$count" =~ ^[0-9]+$ ]]; then
  echo "COUNT must be a non-negative integer; use 0 to run continuously" >&2
  exit 2
fi
if [[ ! "$interval" =~ ^[0-9]+$ ]]; then
  echo "INTERVAL must be a non-negative integer number of seconds" >&2
  exit 2
fi
if [[ "$stop_on_failure" != "true" && "$stop_on_failure" != "false" ]]; then
  echo "STOP_ON_FAILURE must be true or false" >&2
  exit 2
fi
if [[ "$report_root" != /* ]]; then
  report_root="$repo_root/$report_root"
fi
if [[ "$report_root" != "$repo_root"/* ]]; then
  echo "REPORT_ROOT must be inside $repo_root" >&2
  exit 2
fi

repeat_dir="$report_root/repeat"
attempt_log="$repeat_dir/attempts.jsonl"
mkdir -p "$repeat_dir"
: > "$attempt_log"

final_exit=0
attempt=1
while (( count == 0 || attempt <= count )); do
  printf '\n[%s] LLM gateway smoke attempt %d\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$attempt"
  attempt_name="$(printf 'attempt-%04d' "$attempt")"
  attempt_dir="$repeat_dir/$attempt_name"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  set +e
  REPORT_DIR="$attempt_dir/hurl" \
    "$repo_root/scripts/run-functional.sh" tests/smoke tests/llm
  exit_code=$?
  set -e

  if (( exit_code == 0 )); then
    status="passed"
  else
    status="failed"
    final_exit=1
  fi
  jq -cn \
    --argjson attempt "$attempt" \
    --arg status "$status" \
    --arg startedAt "$started_at" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson exitCode "$exit_code" \
    '{attempt: $attempt, status: $status, exitCode: $exitCode, startedAt: $startedAt, finishedAt: $finishedAt}' \
    >> "$attempt_log"

  if (( exit_code != 0 )) && [[ "$stop_on_failure" == "true" ]]; then
    break
  fi

  (( attempt += 1 ))
  if (( count == 0 || attempt <= count )); then
    sleep "$interval"
  fi
done

set +e
"$repo_root/scripts/summarize-repeat.sh" "$repeat_dir"
summary_exit=$?
set -e
if (( summary_exit != 0 )); then
  final_exit=1
fi

exit "$final_exit"
