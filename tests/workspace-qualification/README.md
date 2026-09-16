# Isolated workspace qualification

Run the non-billable daily preflight on the local development host:

```sh
node /home/steve/workspace/light-portal-test/scripts/run-workspace-qualification.mjs
```

Prerequisites: built `light-fabric/target/release/light-workspace`, Git SSH
read access to `networknt/light-agent`, and a private workspace store. Override
`WORKSPACE_BINARY` and `WORKSPACE_STORE` when needed. Registration is idempotent
and rejects changed grants instead of overwriting an existing workspace.

The checked-in registration grants only the two dedicated Workflow Agents access
to `phase1-qualification`. Each run fetches `master`, creates a unique local task
branch, verifies replay, freezes a checkpoint, and verifies that the second Agent
identity observes exactly that checkpoint. It neither pushes nor creates issues,
invokes a model, alters the personal workspace, nor deletes tasks. Reports are in
`reports/workspace-qualification/`. Task checkouts are retained for inspection;
daily operation needs an operator-managed retention policy to avoid disk growth.

For a daily scheduler, invoke the same command as the local workspace owner, with
SSH credentials available non-interactively. No cron entry is installed by this
change. A missing prerequisite is a failure, not a passing skip.

## Coverage boundary

This preflight is **not** proof of native dispatch or manager-to-Workflow snapshot
transfer. Its report explicitly says `nativeDispatchQualified: false`. Use the
separate live gate below for those checks.

Existing non-billable snapshot component regression gates can be run separately:

```sh
cd /home/steve/workspace/light-fabric
cargo test --locked -p light-workflow --test snapshot_transfer
cargo test --locked -p task-workspace --test workspaces fixed_manager_snapshot_read
```
## Live daily snapshot gate

```sh
cd /home/steve/workspace/light-portal-test
npm run qualify:snapshot
```

This runs the approved local `phase1_native_binding_intake` v1.0.6 fixture via
owner-authenticated MCP. It creates a fresh frozen task, dispatches fixed native
manager snapshot reads (no model calls), checks every chunk's confirmed cleanup,
matches the owner-visible result to the host-scoped database record, checks the
checkpoint and Git tree, verifies retained/bound artifact bytes and SHA-256 inside
`light-workflow`, and cancels the exact accepted run to release the personal VM.
It never wipes a database, imports events, publishes configuration, or pushes Git.

Prerequisites:

- Existing v1.0.6 definition, publication and isolated workspace/runner policies
  from the Phase 1 qualification; this script does not provision or alter them.
- The workspace prerequisites above, local `postgres` and `light-workflow`
  containers, Docker access, and both native runners on ports 9444/9445.
- The local Portal UI and its trusted Workflow ingress on
  `https://localhost:3000`, plus Playwright Chromium installed for the existing
  authentication helper. The default public development account is documented
  in `portal-config-loc/README.md` (`steve.hu@lightapi.net`).

The shell entrypoint uses the same `LIGHT_PORTAL_ENV_FILE` (default
`~/.config/lightapi/light-portal.env`) as other daily suites. By default it uses
the existing UI login helper with the public local development account; no manual
token copy is needed. Optional `SNAPSHOT_E2E_EMAIL`/`SNAPSHOT_E2E_PASSWORD`
override those credentials, but the authenticated owner must still match the
qualification policy. Login is restricted to `https://localhost:3000`.
Private session state is kept under `.playwright-auth/snapshot-local/` with a
restrictive umask and excluded from Git. Before each MCP request the helper reuses
a current token or signs in again when less than two minutes remain. The local
issuer's ten-minute token lifetime is unchanged. This is repeated normal login,
not an OAuth refresh-grant or hours-long Workflow renewal qualification.

The client sends the signed-in session cookie and matching CSRF header through
the Portal ingress, which supplies the existing application identity and mTLS.
It does not inject a caller identity or bypass gateway authorization. Only the
existing Portal consent is used. An unrelated interactive browser login does not
need to be copied into the test's isolated session.

`SNAPSHOT_AUTO_LOGIN=false` or `PORTAL_ACCESS_TOKEN_FILE` selects the explicit-token
mode. That mode requires a separately supported bearer ingress and a token with
32 minutes remaining; direct bearer requests to the qualified local gateway are
not a replacement for its trusted Portal ingress. Token files must be private.
Never put issued tokens in command-line arguments or checked-in files.

The default local-login MCP destination is `https://localhost:3000/mcp`.
`SNAPSHOT_MCP_URL` must
remain a local HTTPS `/mcp` endpoint with no query or URL credentials. TLS
verification is on in the Node adapter; the shared test environment may set
`TLS_INSECURE=true` for local self-signed certificates. Prefer a trusted local CA
and `TLS_INSECURE=false`.

Reports are private JSON files under `reports/snapshot-qualification/`; failures
return exit 1, never a passing skip. `active.json` prevents overlap and is retained
after an ambiguous submission, process crash, or unconfirmed cleanup. Do not
blindly remove it: inspect its referenced report, reconcile the saved
feature/transition IDs with the invocation database, cancel only the matching run
through the owner API if needed, and verify the VM is released before archiving
the lock. Re-running with an unresolved lock fails without submitting anything.
For an accepted run whose response was lost, `npm run qualify:snapshot -- --resume`
resolves exactly one persisted invocation using both saved feature and transition
IDs, observes/verifies it and requests cleanup without dispatching another run.
No match or multiple matches fail closed and require operator reconciliation.

A scheduler can invoke the same `npm run qualify:snapshot` command as the local
workspace owner. No cron entry is installed. Tasks and artifacts are retained,
so daily operation also needs an operator-managed retention policy.

Verification during implementation: the new verifier checked the prior completed
run `01a0a32e-d304-7112-b51e-896b8e0b1b19` (three chunks, 323591 bytes) and matched
its stored SHA-256. On 2026-09-15 the normal automatic-login command passed with
fresh run `01a0a4ed-f026-7c83-a71a-836c8972c7d6`; the private report is
`reports/snapshot-qualification/daily-41125681-452a-42c1-98a8-8fbf7d559b44.json`.
The earlier accepted run `01a0a4ed-0649-7be3-9674-670532f93f85` also passed via
exact-run reconciliation after fixing March MCP text-result decoding, without
resubmission. Both transferred three chunks, verified stored artifact bytes and
confirmed VM cleanup. This does not qualify live Claude
snapshot dispatch, crash recovery, publication, or installer behavior.

## Snapshot gate lifecycle and adapter tests

Run `npm run test:workspace` for the transport-independent snapshot qualification
lifecycle tests. The lifecycle in `snapshot-gate.mjs` records submission intent,
never retries an ambiguous submission, cleans up only the exact accepted run,
and fails if artifact verification or VM release is unconfirmed. Exception
bodies are not written to reports.

These tests use injected transports and evidence fixtures; they are not a fresh
live-run result. They cover request correlation, local-only destinations, token
expiry/owner checks, checkpoint/tree and chunk binding, artifact substitution,
ambiguous dispatch, and failure cleanup.
# Explicit native cleanup interruption gate

`scripts/qualify-native-cleanup-interruption.mjs` is an opt-in destructive local
fault test, not an unattended daily smoke. It requires the dedicated Codex runner
built with `qualification-hooks`, a private `/tmp/phase1-native-crash.*` directory
configured in `LIGHT_RUNNER_CLEANUP_QUALIFICATION_DIR`, and a temporary `Restart=no`
unit override. Both runner and Controller must support late lease-cleanup receipts.
Set `ALLOW_LOCAL_RUNNER_INTERRUPTION=yes` and pass the directory as its argument.

The driver starts the normal isolated snapshot qualification, verifies the exact
feature owns the VM and execution is STARTED with cleanup unconfirmed, then kills
only the runner's main process inside the cleanup barrier. It checks reservation
and lease/fence retention while down, restarts the runner, and requires UNKNOWN /
CONFIRMED and VM release for that same execution. The enclosed snapshot is expected
to fail; the fault gate passes only if recovery succeeds. No model or GitHub writes
are required. Always restore the normal non-hook binary, matching admission digest,
and restart policy afterward. Preserve any unresolved active-run lock.
