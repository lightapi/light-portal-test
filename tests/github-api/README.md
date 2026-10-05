# GitHub Gateway reads and Workflow UI acceptance

`make github-api` runs two live, read-only tests against issue `lightapi/light-portal#725` and its comments (`page=1&per_page=30`), plus a UI start/completion test of the published `github-api-workflow` version `1.0.0`. The lane also runs in `make all`, after API Gateway publication. Failures are not silently skipped.

Prerequisites: running Gateway with the GitHub REST API published, caller ACL permission, configured outbound PAT and verified upstream TLS. These tests never read/provision the PAT. They reuse the API Gateway publication lane's Portal authentication state and login setup, including its `API_GATEWAY_E2E_*` settings and `LIGHT_PORTAL_ENV_FILE` convention.

- `GITHUB_API_GATEWAY_URL`: HTTPS Gateway origin, default `https://localhost` (separate from the UI login URL on port 3000).
- `GITHUB_API_CA_FILE`: Gateway CA bundle, default the sibling canonical `portal-config-loc/all-in-lt/light-gateway-rust/config/ca.pem`.
- `API_GATEWAY_E2E_AUTH_STATE_FILE`: optional existing Portal state file; default `.playwright-auth/api-gateway-publication/state.json`.

The Gateway reads always validate certificate chains and hostnames, even when the existing UI login uses `TLS_INSECURE`. Redirects are not followed, responses are limited to 1 MiB, and traces/videos/screenshots are disabled to keep caller headers out of artifacts. Reports: `reports/github-api/junit.xml`.

The UI test requires the existing published definition `01a10963-a48f-717d-8039-129e6d60801c` on Host `01964b05-552a-7c4b-9184-6857e7f3dc5f`, its dev bindings and Tool Workflow Access, and a signed-in caller with the `github-reader` role and permission to view operational Process Info. It creates one fresh Workflow invocation through the UI with input `{"owner":"networknt","repo":"light-fabric","issue_number":429}`. It does not import fixtures, publish definitions, change grants or retry an uncertain start. It follows Operational Status for the accepted instance and requires both Process and Invocation to reach `COMPLETED` within 150 seconds; FAILED/CANCELLED fail immediately. The lane disables automatic retries and sensitive browser artifacts.

Run only this acceptance check from the repository root:

```sh
bash scripts/run-github-api.sh workflow-ui.spec.js
```

Run the complete integration suite with `make all`. Each execution creates a new invocation and makes the workflow's two GitHub GETs. These checks depend on live GitHub availability and configured credentials. They do not establish full comments pagination, private-repository scope, write access, ACL denial, native-agent execution or design-document generation. An empty comments page is valid.
