#!/usr/bin/env bash
# Optional white-box complement: runs the authoritative source regression tests.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${MCP_SOURCE_WORKSPACE:-$(dirname "$repo_root")}"
report_dir="$repo_root/reports/mcp-source"
mkdir -p "$report_dir"
for repo in light-fabric light-example-rs portal-service light-portal controller-rs; do
  if [[ ! -d "$workspace/$repo" ]]; then
    echo "Missing $workspace/$repo; set MCP_SOURCE_WORKSPACE to the source workspace" >&2
    exit 2
  fi
done
run_check() {
  local name="$1" directory="$2"
  shift 2
  echo "MCP source regression: $name"
  if (cd "$directory" && "$@") >"$report_dir/$name.log" 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name; see $report_dir/$name.log" >&2
    return 1
  fi
}
run_check client "$workspace/light-fabric" cargo test --locked -p mcp-client
run_check gateway "$workspace/light-fabric" cargo test --locked -p light-pingora mcp
run_check controller "$workspace/controller-rs" cargo test --locked --test websocket_flows
run_check registry "$workspace/light-fabric" cargo test --locked -p portal-registry
run_check insurance "$workspace/light-example-rs" cargo test --locked -p demo-insurance-claim-mcp-server
run_check oauth "$workspace/portal-service" cargo test --locked -p light-oauth
run_check publication "$workspace/light-portal" mvn -q -pl db-provider -am test \
  -Dtest=McpSchemaPublicationTest,GatewayToolPublicationPersistenceImplTest -Dsurefire.failIfNoSpecifiedTests=false
