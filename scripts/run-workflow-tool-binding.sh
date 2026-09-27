#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${WORKFLOW_TOOL_BINDING_FIXTURE:?set a non-secret Portal command fixture JSON path}"
: "${WORKFLOW_TOOL_BINDING_AUTHOR_STATE:?set author Playwright storage state path}"
: "${WORKFLOW_TOOL_BINDING_OWNER_STATE:?set owner Playwright storage state path}"
: "${WORKFLOW_TOOL_BINDING_HURL_VARS:?set private Hurl variables file path}"
: "${HURL_BIN:=hurl}"
export HURL_BIN
cd "$repo_root"
npx playwright test --config playwright.workflow-tool-binding.config.js
"$HURL_BIN" --test --variables-file "$WORKFLOW_TOOL_BINDING_HURL_VARS" \
  --to-entry 6 tests/workflow-tool-binding/workflow-backed-tool.hurl
"$HURL_BIN" --test --variables-file "$WORKFLOW_TOOL_BINDING_HURL_VARS" \
  --from-entry 8 --to-entry 8 tests/workflow-tool-binding/workflow-backed-tool.hurl
