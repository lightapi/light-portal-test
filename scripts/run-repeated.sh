#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
count="${COUNT:-10}"
interval="${INTERVAL:-10}"

if [[ ! "$count" =~ ^[0-9]+$ ]]; then
  echo "COUNT must be a non-negative integer; use 0 to run continuously" >&2
  exit 2
fi
if [[ ! "$interval" =~ ^[0-9]+$ ]]; then
  echo "INTERVAL must be a non-negative integer number of seconds" >&2
  exit 2
fi

attempt=1
while (( count == 0 || attempt <= count )); do
  printf '\n[%s] LLM gateway smoke attempt %d\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$attempt"
  "$repo_root/scripts/run-functional.sh" tests/smoke tests/llm
  (( attempt += 1 ))
  if (( count == 0 || attempt <= count )); then
    sleep "$interval"
  fi
done
