#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

mapfile -t shell_files < <(find "$repo_root/scripts" -type f -name '*.sh' -print | sort)
for file in "${shell_files[@]}"; do
  bash -n "$file"
done

for file in "$repo_root"/scripts/run-*.sh; do
  if [[ ! -x "$file" ]]; then
    echo "runner script is not executable: $file" >&2
    exit 1
  fi
done

"$repo_root/scripts/validate-token-fixtures.sh"
python3 -B -m unittest discover -s "$repo_root/tests/claude-personal" -p 'test_*.py'

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
mapfile -t node_files < <(find "$repo_root/runner" "$repo_root/tests/promotion-ui" "$repo_root/tests/mcp" -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
if command -v node >/dev/null 2>&1; then
  for file in "${k6_files[@]}"; do
    node --check "$file"
  done
  for file in "${node_files[@]}"; do
    node --check "$file"
  done
  node --test "$repo_root"/runner/*.test.mjs "$repo_root"/tests/mcp/*.test.mjs
  if [[ -x "$repo_root/node_modules/.bin/playwright" ]]; then
    PROMOTION_SOURCE_HOST_ID=00000000-0000-0000-0000-000000000001 \
    PROMOTION_SOURCE_HOST_LABEL='source / canary' \
    PROMOTION_TARGET_HOST_ID=00000000-0000-0000-0000-000000000002 \
    PROMOTION_TARGET_HOST_LABEL='target / canary' \
    PROMOTION_PLATFORM_MATCH=platform-canary \
    PROMOTION_PIPELINE_MATCH=pipeline-canary \
    PROMOTION_PIPELINE_VERSION=1.0.0 \
    PROMOTION_PRODUCT_ID=product-canary \
    PROMOTION_PRODUCT_VERSION=1.0.0 \
      "$repo_root/node_modules/.bin/playwright" test tests/promotion-ui --list
  else
    echo "warning: Playwright is not installed; skipping promotion test discovery (run npm ci)" >&2
  fi
else
  echo "warning: node is not installed; skipping JavaScript syntax checks" >&2
fi

echo "validated ${#shell_files[@]} shell scripts, ${#hurl_files[@]} Hurl tests, ${#k6_files[@]} k6 scripts, and ${#node_files[@]} Node files"
