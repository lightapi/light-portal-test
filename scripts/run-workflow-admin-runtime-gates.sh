#!/usr/bin/env bash
set -euo pipefail

mode="${1:-contract}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(cd "$root/.." && pwd)"
if [[ -d "$root/light-fabric/apps/light-workflow/contracts/workflow-admin" ]]; then
  contract_dir="$root/light-fabric/apps/light-workflow/contracts/workflow-admin"
else
  contract_dir="$workspace/light-fabric/apps/light-workflow/contracts/workflow-admin"
fi
fixture_dir="$root/workflow-admin-runtime"
evidence_dir="${WORKFLOW_ADMIN_EVIDENCE_DIR:-$workspace/implementation/light-portal/workflow-admin-runtime/qualification}"

node "$contract_dir/validate-contracts.mjs"
node "$fixture_dir/validate-fixtures.mjs"
node "$fixture_dir/validate-evidence.test.mjs"

case "$mode" in
  contract)
    echo "NOTICE contract-only validation passed; current-state runtime qualification remains OPEN"
    ;;
  archive)
    node "$fixture_dir/validate-evidence.mjs" archive "$evidence_dir/phase0-diagnosis-archive.json"
    ;;
  runtime)
    if [[ -z "${WORKFLOW_ADMIN_FIXTURE_DRIVER:-}" || ! -x "${WORKFLOW_ADMIN_FIXTURE_DRIVER:-}" ]]; then
      echo "FAIL $mode mode requires executable WORKFLOW_ADMIN_FIXTURE_DRIVER; runtime qualification is OPEN" >&2
      exit 2
    fi
    mkdir -p "$evidence_dir"
    run_dir="$(mktemp -d "$evidence_dir/.workflow-admin-runtime.XXXXXXXX")"
    trap 'rm -rf -- "$run_dir"' EXIT
    "$WORKFLOW_ADMIN_FIXTURE_DRIVER" --fixture "$fixture_dir/assigned-ask/fixture.json" --mode "$mode" --evidence "$run_dir/runtime-assigned-ask.json"
    "$WORKFLOW_ADMIN_FIXTURE_DRIVER" --fixture "$fixture_dir/between-stage-vm/fixture.json" --mode "$mode" --evidence "$run_dir/runtime-between-stage-vm.json"
    node "$fixture_dir/validate-evidence.mjs" "$mode" "$run_dir/runtime-assigned-ask.json" "$run_dir/runtime-between-stage-vm.json"
    mv -- "$run_dir/runtime-assigned-ask.json" "$evidence_dir/runtime-assigned-ask.json"
    mv -- "$run_dir/runtime-between-stage-vm.json" "$evidence_dir/runtime-between-stage-vm.json"
    rmdir -- "$run_dir"
    trap - EXIT
    ;;
  *)
    echo "usage: $0 [contract|archive|runtime]" >&2
    exit 2
    ;;
esac

echo "PASS workflow-admin-runtime gates ($mode)"
