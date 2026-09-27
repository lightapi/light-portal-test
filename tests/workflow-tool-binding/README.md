# Workflow Tool binding qualification lane

This lane prepares Step 18 checks 1–8, 9–14, 16, and 18. Listing and syntax
checks do not execute them. Run it only against a stack explicitly prepared for
qualification. The Playwright test runs the publication sequence serially;
the Hurl file calls the published Tool.

## UI fixture setup

In Portal, create three distinct users: a definition **owner** with
`workflow-admin`, a Tool **author** with `genai-admin` who is not the owner and
has no `workflow-admin` role, and a third caller for later denial checks. Save
owner and author Playwright storage states to private files outside Git. Do
not put passwords, bearer tokens, cookies, or their contents in this lane.

As owner, use Workflow Definitions / Workflow Editor to create an owned,
catalog-visible definition D with a saved v1.0.0. Include deterministic
`scenario` inputs for a completed output, a failing task with a recognizable
message, and a slow task. The completed output must expose the invocation's
instance ID as `workflowInstanceId` so the Hurl replay check can compare two
instances after `resultReplayMs: 0`. Prepare v1.1.0 with an additional endpoint target
and v1.2.0 with `bindingApproval: reapprove`, saving each version through the
editor. The fixture needs Workflow MCP publication and Gateway ACL assignments
from the Workflow Invoke operator setup, including the publisher client ID and
run credential keyring.

As author, use Tools → Create New Tool to create T with execution placement
`workflow`, pinned to D v1.0.0 and a bounded synchronous invocation. Set
`idempotencyPolicy.kind: derived` and `resultReplayMs: 0` for this read-only
Tool. Give it a Gateway
instance and a caller role allowed by its Tool ACL. Its input schema must
declare `scenario` and `probeId`; its active v1.0.0 output must contain a
distinct marker recorded as `activeRevisionMarker` in the private JSON
fixture. Check 10 invokes T after a pending deadline change and requires
that marker. Check 12 invokes T after revocation and requires
`WORKFLOW_POLICY_DENIED`.

Prepare a separate approved, Gateway-published slow capacity Tool with a
per-user admission limit of exactly 2. Its input schema must declare
`scenario` and `key`, and its slow path must keep both Workflow runs active
through two Gateway wait timeouts and the third request. The lane starts two
same-user calls with distinct keys concurrently, verifies two different
nonterminal instance IDs, sends the third capacity request through Hurl, and
cancels and waits for both runs in `finally`. The user token in the private
Hurl variables file must be authorized for that Tool, `workflow_get_status`,
and `workflow_cancel`, because the same token handles setup and cleanup.
Save T's ID, name and Host ID.
Use Portal UI or Portal
commands for every change; never insert into projection tables.
Prepare a second, already approved and Gateway-published Tool for the Hurl
calls. It must remain active while T goes through rejection and revocation;
set `workflow_tool_name` to that Tool in the private Hurl variables file. Its
input schema must declare the exact `idempotencyKey` property in addition to
`scenario` and `key`. Configure `idempotencyPolicy.kind: explicit` and
`resultReplayMs: 0` for that read-only Tool and a
slow path long enough for the retry to attach before completion. The two slow
Hurl calls send identical `arguments`, including the key inside `arguments`.

Create a private JSON fixture and set `WORKFLOW_TOOL_BINDING_FIXTURE` to its
path. It contains `hostId`, `toolId`, `toolName`, `activeRevisionMarker`,
`rejectionComment`, and
`commands` arrays named `publishV1`, `republishV1`, `publishSelected`,
`approve`, `publishGateway`, `descriptionOnly`, `deadlineChange`, `reject`,
`revoke`, `publishV11AndRepin`, and `publishV12AndRepin`. Each array contains
Portal command envelopes `{actor, service, action, data}`. Use `owner` or
`author` for `actor`; the test reads the corresponding private browser state.
For example, `publishSelected` calls `genai/publishWorkflowToolBindings`
with `{hostId, toolIds:[toolId]}`. `approve`, `reject`, and `revoke` use
`workflow/decideWorkflowToolBinding` or
`workflow/revokeWorkflowToolBinding` with the Workflow binding ID and digest
returned by the preceding step. Definition publication uses
`workflow/publishWfDefinition` with the saved editor version and its current
aggregate version. Description, deadline and re-pin changes must be normal
Portal Tool commands. Use `captures` on a command item to copy a field from
its result into a named value, then `{{name}}` in later command `data` fields
to supply the fresh aggregate version, binding ID, or digest. A stale fixture
is expected to fail closed.

Set `WORKFLOW_TOOL_BINDING_AUTHOR_STATE` and
`WORKFLOW_TOOL_BINDING_OWNER_STATE` to the private storage-state paths. Set
`PROMOTION_UI_BASE_URL` to the Portal UI. Set `WORKFLOW_TOOL_BINDING_HURL_VARS`
to a private Hurl variables file containing `mcp_base_url`, `access_token`,
`workflow_tool_name`, `capacity_tool_name`, and a unique `run_id`. The lane
establishes the two admitted same-user runs for check 16 and requires the
third to fail with `WORKFLOW_CAPACITY_EXHAUSTED`. The Hurl file checks
error and timeout envelopes, new-instance behavior, and direct
`workflow_invoke` refusal. Check the runtime log separately for the check 5
absence of a light-oauth request.

Run `make workflow-tool-binding` only after the fixture and private variables
are ready. To inspect without contacting the stack, run
`npx playwright test --list -c playwright.workflow-tool-binding.config.js`
and `hurlfmt --out json -o /tmp/workflow-backed-tool-hurl-ast.json
tests/workflow-tool-binding/workflow-backed-tool.hurl`. The latter parses the
file and writes its AST without sending requests. Then run
`node scripts/check-workflow-tool-binding-requests.mjs
/tmp/workflow-backed-tool-hurl-ast.json` to assert that every request has the
stateless MCP metadata and headers, that neither retry uses
`params.idempotencyKey`, and that both retry `arguments` objects are identical.
The Playwright lane executes Hurl entry 7 only after admitting two capacity
runs; the shell runner executes entries 1–6 and 8 separately.

## Cleanup

Through the Portal UI or commands, retire the test Tool binding, remove its
Gateway publication, retire the test definition versions after the binding is
no longer pinned, and deactivate the Tool and definition. Remove the private
storage-state and Hurl variables files using the operator's normal secret
handling. Do not delete Workflow or Portal projection rows with SQL.
