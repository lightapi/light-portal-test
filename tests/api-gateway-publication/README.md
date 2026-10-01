# API Gateway publication lifecycle

Run `make api-gateway-publication-ui` or `npm run test:api-gateway-publication` from the repository root.

`make all` also runs this lane after `rule-execution-ui`, using the same private credentials and local Gateway defaults described below.

This serial Playwright test exercises one OpenAPI GET endpoint on `portal-bff-loc` through Portal UI forms, endpoint Bulk Access, the publication dialog, and API/version deletion actions. It checks accepted commands against subsequent Portal queries rather than treating a success message as projection completion.

Each run performs two complete cycles:

1. Create/reactivate `ACL_TEST_API` and version `1.0.0` with the checked-in single-endpoint specification.
2. Open Endpoints → Access Overview → Bulk Access, assign an existing request access rule and an `admin` role permission, then verify both source ACL records.
3. Publish to `portal-bff-loc`; verify the active association, compiled role permission, and request rule. Verify unrelated endpoint ACLs are unchanged.
4. Retire through the same dialog; wait for projection, verify the association is inactive and the test ACL is gone, and compare both Gateway ACL maps against the baseline.
5. Verify repeated removal is a no-op, delete the API version and API through the UI, and verify both are inactive.
6. Repeat the lifecycle, asserting that the API version, endpoint, and Gateway association UUIDs are reused.

The fixture remains as soft-deleted history after the run, so subsequent invocations test reactivation too. Source permission/rule rows can already exist; Bulk Access uses Skip Existing, and the test checks their projected values in both cycles. Setup and failure cleanup use ordinary authenticated Portal commands and touch only this marked fixture. An API/version with the same identity and a different ownership marker is rejected before mutation. No direct SQL or event-store writes are used.

This is **live UI plus desired-configuration projection evidence**. It does not create/activate configuration snapshots, restart the Gateway, or assert request-time access enforcement. The current snapshot ID must remain unchanged. Use it while no other operator is editing the target Gateway; concurrent unrelated changes fail the preservation comparison rather than being overwritten.

## Configuration

The runner reads `LIGHT_PORTAL_ENV_FILE` (default `~/.config/lightapi/light-portal.env`) and preserves explicitly supplied overrides. Credentials must come from that private file/environment or a valid Playwright storage state; none are checked into the test.

| Variable | Default / use |
| --- | --- |
| `API_GATEWAY_E2E_BASE_URL` | `https://localhost:3000` |
| `API_GATEWAY_E2E_AUTH_STATE_FILE` | `.playwright-auth/api-gateway-publication/state.json` |
| `API_GATEWAY_E2E_EMAIL`, `API_GATEWAY_E2E_PASSWORD`, `API_GATEWAY_E2E_USER_TYPE` | Fall back to `PROMOTION_E2E_*`; state with at least ten minutes of token lifetime bypasses login |
| `API_GATEWAY_E2E_HOST_ID` | Local Light API Host `01964b05-552a-7c4b-9184-6857e7f3dc5f`; must match authenticated Host |
| `API_GATEWAY_E2E_INSTANCE_NAME` | `portal-bff-loc`, resolved to one eligible Gateway UUID |
| `API_GATEWAY_E2E_API_ID` | `ACL_TEST_API`; use a dedicated identity of at most 16 characters |
| `API_GATEWAY_E2E_RULE_ID` | Existing `req-access-light-portal.lightapi.net` request access rule |
| `API_GATEWAY_E2E_ROLE_ID` | Existing `admin` role |
| `API_GATEWAY_E2E_REPORT_ROOT` | `reports/api-gateway-publication` |
| `TLS_INSECURE` | `true` for the local self-signed certificate |

The API ID also determines its isolated path `/_portal-test/api-publication/<lowercase-api-id>/ping`. It has no forwarding route and makes no external API calls. The test uses a local exclusive fixture lock under `.playwright-auth/api-gateway-publication`; after a process crash, inspect/clean its fixture before manually removing the leftover lock.

Reports contain JUnit, failure screenshots, and a `lifecycle-evidence` JSON attachment with fixture UUIDs, transaction/correlation IDs, graph revisions, cleanup status, and the qualification lane. Network traces and videos are disabled. Reports and authentication state are Git-ignored.

List without logging in or changing data:

```sh
npm run test:api-gateway-publication:list
```
