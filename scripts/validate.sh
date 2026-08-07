#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

mapfile -t shell_files < <(find "$repo_root/scripts" -type f -name '*.sh' -print | sort)
for file in "${shell_files[@]}"; do
  bash -n "$file"
done

"$repo_root/scripts/validate-token-fixtures.sh"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x -P "$repo_root/scripts" "${shell_files[@]}"
else
  echo "warning: shellcheck is not installed; skipping shell lint" >&2
fi

mapfile -t hurl_files < <(find "$repo_root/tests" -type f -name '*.hurl' -print | sort)
if (( ${#hurl_files[@]} == 0 )); then
  echo "no Hurl tests found" >&2
  exit 1
fi
for file in "${hurl_files[@]}"; do
  if [[ ! -s "$file" ]]; then
    echo "empty Hurl test: $file" >&2
    exit 1
  fi
done

mapfile -t k6_files < <(find "$repo_root/performance" -type f -name '*.js' -print | sort)
if command -v node >/dev/null 2>&1; then
  for file in "${k6_files[@]}"; do
    node --check "$file"
  done
else
  echo "warning: node is not installed; skipping JavaScript syntax checks" >&2
fi

echo "validated ${#shell_files[@]} shell scripts, ${#hurl_files[@]} Hurl tests, and ${#k6_files[@]} k6 scripts"
