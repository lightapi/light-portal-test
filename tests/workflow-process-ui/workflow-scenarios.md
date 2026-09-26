# Workflow UI scenarios in `make all`

`make all` already invokes `workflow-process-ui`; that suite includes `workflow-scenarios.spec.js`. The two cases create new Workflow instances. The second case claims and approves a new `test01` task with the signed-in account, so use a Portal user whose current token carries the `admin` role.

Before running, publish the local definitions and make sure Workflow, Gateway, Portal, and the UI are running. The default local Host and definitions are:

| Setting | Default |
| --- | --- |
| `WORKFLOW_TEST_HOST_ID` | `01964b05-552a-7c4b-9184-6857e7f3dc5f` |
| `WORKFLOW_SIMPLE_DEF_ID` | `019e4881-9637-731c-a443-6590d25c5204` (`simple-set-assert` 1.0.4) |
| `WORKFLOW_APPROVAL_DEF_ID` | `01a001ca-f27d-7f80-a1e7-fbb84d5422f6` (`test01` 1.0.2) |

Override these environment variables when running against another Host or definition catalog. Use `WORKFLOW_AUTH_STATE_FILE` for an authenticated browser session, or set `WORKFLOW_E2E_EMAIL`, `WORKFLOW_E2E_PASSWORD`, and optionally `WORKFLOW_E2E_USER_TYPE` as documented by the existing workflow UI runner. Credentials remain in your environment; do not put them in this repository.

Run both cases with `make workflow-process-ui`, or run the complete suite with `make all`. The simple case starts in the Editor and requires `COMPLETED` in Process Info. The approval case starts in the Editor, requires `WAITING`, finds the assignment belonging to the new instance through a read only Gateway MCP call, then claims and approves it on the Human Task page and requires `COMPLETED` in Process Info.

The tests do not run automatically during development. A failed test may leave a process or a claimed task for manual investigation; the runner does not cancel or delete it. Inspect `reports/workflow-process-ui/` for results. A local browser run is required before these scenarios can be called live qualified.
