# GitHub Gateway reads and Workflow UI acceptance

`make github-api` runs six live GET tests against issue `lightapi/light-portal#725` and its comments (`page=1&per_page=30`), followed by the existing UI start/completion test of the published `github-api-workflow` version `1.0.0`. The lane runs exactly once in `make all`, after API Gateway publication. Failures are not silently skipped.

Prerequisites: running Gateway with the GitHub REST API published, caller ACL permission, configured outbound PAT and verified upstream TLS. These tests never read/provision the PAT. They reuse the API Gateway publication lane's Portal authentication state and login setup, including its `API_GATEWAY_E2E_*` settings and `LIGHT_PORTAL_ENV_FILE` convention.

- `GITHUB_API_GATEWAY_URL`: HTTPS Gateway origin, default `https://localhost` (separate from the UI login URL on port 3000).
- `GITHUB_API_CA_FILE`: Gateway CA bundle, default the sibling canonical `portal-config-loc/all-in-lt/light-gateway-rust/config/ca.pem`.
- `API_GATEWAY_E2E_AUTH_STATE_FILE`: optional existing Portal state file; default `.playwright-auth/api-gateway-publication/state.json`.
- `API_GATEWAY_E2E_BASE_URL`, `API_GATEWAY_E2E_EMAIL`, `API_GATEWAY_E2E_PASSWORD`, `API_GATEWAY_E2E_USER_TYPE`: authorized login settings; credential settings fall back to the normal private `PROMOTION_E2E_*` values.
- `GITHUB_API_DENIED_EMAIL`, `GITHUB_API_DENIED_PASSWORD`, `GITHUB_API_DENIED_USER_TYPE`: separate denied login settings. The approved account is `ke.hu@lightapi.net`, user ID `01a10dc1-4365-76d5-bfce-6b1b8a9350d0`, with exactly role `user`. Localhost uses the owner-approved local test default when no password override is set; other hosts require a private password. Explicit empty credentials fail.
- `GITHUB_API_DENIED_AUTH_STATE_FILE`: optional separate private denied state. A supplied missing/expired/unusable state fails without login or unauthenticated fallback. Administrator state, including symlink aliases, is rejected. Without this setting, a fresh empty browser context uses the normal home-page login and retains the denied token only in memory; it does not open a promotion page or write state.
- `GITHUB_API_GATEWAY_CONTAINER`: read-only Docker log source, default `light-gateway`. Authenticated-denial tests require access to its correlated ACL telemetry. Missing provenance fails rather than passing on HTTP status alone.
- `GITHUB_API_EVIDENCE_DB_CONTAINER`, `GITHUB_API_GATEWAY_INSTANCE`: default `postgres` and `portal-bff-loc`. All four rejection tests require one correlated `gateway.authorization.denied` record in the existing `operations.gateway_ops.gateway_evidence_spool_t` table, read in a read-only transaction. Telemetry polling is bounded and never retries an HTTP request.

Explicit runner environment values override `LIGHT_PORTAL_ENV_FILE`, including empty values. Store private credentials/state outside source control. The example configuration documents names without credentials. Supplied denied state is checked for the approved identity, token lifetime and exactly the `user` role before dispatch; administrative or other unexpected roles fail.

The six tests run in order: authorized issue/comments (200 with existing shape assertions), authenticated user issue/comments (403 from their distinct registered policies), then unauthenticated issue/comments (401 from authentication). Every request has a fresh correlation ID and is sent once. A denied pass requires the exact selected-policy response and a matching Gateway ACL event for the approved user. Missing/wildcard policy errors, transport failures and upstream 401/403 responses fail. Authentication rejection requires `ERR10002`, the missing caller-token reason, Bearer challenge and correlated Gateway audit. Local rejection responses need not echo the correlation header. Responses and allowlisted telemetry establish rejection provenance; these records do **not** independently prove absence of upstream dispatch. Qualification reports must state what separate deployed stage telemetry establishes, and retain any limitation. Synthetic recorder observations are component evidence only.

The Gateway reads always validate certificate chains and hostnames, even when the existing UI login uses `TLS_INSECURE`. Redirects are not followed, responses are limited to 1 MiB, automatic retries are off, and traces/videos/screenshots are disabled. Raw request objects, tokens, credentials, response bodies and container logs are not attached. Reports: `reports/github-api/junit.xml`, `results.json` and sanitized per-probe JSON attachments in `artifacts/`.

Run only the six maintained reads for live ACL qualification, without publication, Workflow or model execution:

```sh
bash scripts/run-github-api.sh reads.spec.js
bash scripts/run-github-api.sh --list
make validate
```

The UI test requires the existing published definition `01a10963-a48f-717d-8039-129e6d60801c` on Host `01964b05-552a-7c4b-9184-6857e7f3dc5f`, its dev bindings and Tool Workflow Access, and a signed-in caller with the `github-reader` role and permission to view operational Process Info. It creates one fresh Workflow invocation through the UI with input `{"owner":"networknt","repo":"light-fabric","issue_number":429}`. It does not import fixtures, publish definitions, change grants or retry an uncertain start. It follows Operational Status for the accepted instance and requires both Process and Invocation to reach `COMPLETED` within 150 seconds; FAILED/CANCELLED fail immediately. The lane disables automatic retries and sensitive browser artifacts.

Run only this acceptance check from the repository root:

```sh
bash scripts/run-github-api.sh workflow-ui.spec.js
```

Run the complete integration suite with `make all` only when its publication, Workflow and billable lanes are authorized. Each complete lane execution creates a new invocation and makes the workflow's two GitHub GETs. These checks depend on live GitHub availability and configured credentials. They do not establish full comments pagination, private-repository scope, write access, native-agent execution or design-document generation. An empty comments page is valid.
