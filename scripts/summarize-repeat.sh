#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <repeat-report-directory>" >&2
  exit 2
fi

repeat_dir="$1"
attempt_log="$repeat_dir/attempts.jsonl"
summary_file="$repeat_dir/summary.json"
warn_p95_ms="${REPEAT_WARN_P95_MS:-10000}"
fail_p95_ms="${REPEAT_FAIL_P95_MS:-30000}"

for value_name in warn_p95_ms fail_p95_ms; do
  value="${!value_name}"
  if [[ ! "$value" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "${value_name^^} must be a non-negative number" >&2
    exit 2
  fi
done
if ! awk -v warn="$warn_p95_ms" -v fail="$fail_p95_ms" 'BEGIN { exit !(warn < fail) }'; then
  echo "REPEAT_WARN_P95_MS must be lower than REPEAT_FAIL_P95_MS" >&2
  exit 2
fi
if [[ ! -f "$attempt_log" ]]; then
  echo "repeat attempt log not found: $attempt_log" >&2
  exit 2
fi

mapfile -t report_files < <(find "$repeat_dir" -path '*/hurl/json/report.json' -type f -print | sort)

jq -s \
  --slurpfile attempts "$attempt_log" \
  --argjson warnP95Ms "$warn_p95_ms" \
  --argjson failP95Ms "$fail_p95_ms" '
    def percentile($values; $fraction):
      ($values | sort) as $sorted
      | if ($sorted | length) == 0 then null
        else $sorted[((($sorted | length) * $fraction | ceil) - 1)]
        end;
    def rounded: if . == null then null else (. * 100 | round) / 100 end;

    [ .[] | .[] as $file
      | $file.entries[] | .calls[]
      | {
          test: $file.filename,
          success: $file.success,
          httpStatus: .response.status,
          durationMs: (.timings.total / 1000)
        }
    ] as $calls
    | ($calls | map(.durationMs)) as $durations
    | ($attempts | map(select(.status == "failed")) | length) as $failedAttempts
    | (percentile($durations; 0.95)) as $p95
    | (if $failedAttempts > 0 then "fail"
       elif $p95 != null and $p95 >= $failP95Ms then "fail"
       elif $p95 != null and $p95 >= $warnP95Ms then "warn"
       else "pass"
       end) as $status
    | {
        status: $status,
        generatedAt: (now | todateiso8601),
        thresholds: {
          warnP95Ms: $warnP95Ms,
          failP95Ms: $failP95Ms
        },
        attempts: {
          total: ($attempts | length),
          passed: ($attempts | map(select(.status == "passed")) | length),
          failed: $failedAttempts
        },
        requests: ($calls | length),
        latencyMs: {
          p50: (percentile($durations; 0.50) | rounded),
          p95: ($p95 | rounded),
          max: (($durations | max // null) | rounded)
        },
        byTest: [
          $calls | group_by(.test)[]
          | . as $group
          | ($group | map(.durationMs)) as $testDurations
          | {
              test: $group[0].test,
              requests: ($group | length),
              p50Ms: (percentile($testDurations; 0.50) | rounded),
              p95Ms: (percentile($testDurations; 0.95) | rounded),
              maxMs: (($testDurations | max) | rounded)
            }
        ]
      }
  ' "${report_files[@]}" > "$summary_file"

status="$(jq -r '.status' "$summary_file")"
attempts="$(jq -r '.attempts.total' "$summary_file")"
failed="$(jq -r '.attempts.failed' "$summary_file")"
p95="$(jq -r '.latencyMs.p95 // "n/a"' "$summary_file")"
maximum="$(jq -r '.latencyMs.max // "n/a"' "$summary_file")"

printf '\nRepeat summary: status=%s attempts=%s failed=%s p95=%sms max=%sms\n' \
  "$status" "$attempts" "$failed" "$p95" "$maximum"
echo "Report: $summary_file"

case "$status" in
  warn)
    echo "WARNING: repeat p95 latency is at or above ${warn_p95_ms}ms" >&2
    ;;
  fail)
    echo "FAILURE: a repeat attempt failed or p95 latency reached ${fail_p95_ms}ms" >&2
    exit 1
    ;;
esac
