# Workflow LONG binding deletion UI test

This Playwright case creates a unique ACTIVE LONG binding through the issuer API,
deletes it on the Portal **Workflow owner bindings** page, waits for the query
projection to remove the row, and checks that the next exchange is denied. It
then sends the first terminal close twice and checks the recorded issuer version.
An incorrect workflow instance and an unknown binding must remain unauthorized.

Run against a qualification environment with the tombstone migrations and the
new Portal projector deployed. The Gateway must authorize the UI account for
`lightapi.net/oauth/getWorkflowBinding/0.1.0` and
`lightapi.net/oauth/deleteWorkflowBinding/0.1.0`. The test checks the query
before registering a binding, so a missing rule fails without creating a fixture.
Use a Portal account authorized to delete Workflow bindings, an active LONG
Workflow OAuth client, and a fresh user access token for the same tenant Host
with exactly `portal.r portal.w` scope. The local Workflow app client values
are in the test case; Portal login credentials and user access tokens are not.

Required environment variables:

- Either `WORKFLOW_LONG_AUTH_STATE_FILE` with a valid Portal session, or
  `WORKFLOW_LONG_E2E_EMAIL` and `WORKFLOW_LONG_E2E_PASSWORD` for UI login.

Optional variables:

- `WORKFLOW_LONG_SOURCE_TOKEN`: a fresh user access token; otherwise the test
  uses the Portal session's `accessToken` cookie.
- `WORKFLOW_LONG_HOST_ID`: overrides the tenant Host read from the source token;
  when set, it must match the token's `host` claim.
- `WORKFLOW_LONG_CLIENT_ID` and `WORKFLOW_LONG_CLIENT_SECRET`: override the
  local Workflow app client values in the test case.
- `WORKFLOW_LONG_E2E_USER_TYPE`: login user type, when the login form requires it.
- `WORKFLOW_LONG_PROVIDER_ID`: defaults to `AZZRJE52eXu3t1hseacnGQ`.
- `WORKFLOW_LONG_UI_BASE_URL`: defaults to `https://localhost:3000`.
- `WORKFLOW_LONG_ISSUER_BASE_URL`: defaults to `https://localhost` (Gateway).
- `TLS_INSECURE=false`: require a trusted local TLS certificate.

From the repository root, run `make workflow-long-binding-ui`. The Make target
loads the same `LIGHT_PORTAL_ENV_FILE` used by the existing Workflow UI runner
for login defaults; explicit `WORKFLOW_LONG_*` values take precedence. You can
also run `npm run test:workflow-long-binding` with all variables already
exported. The test creates a real binding and
appends a real deletion event. Run it only against a qualification Host. If the
test fails after registration, teardown sends a terminal CANCELED close to
prevent further exchanges. The binding row may remain until it is deleted from
the same UI page.
