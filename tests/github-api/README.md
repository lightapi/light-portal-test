# GitHub Gateway reads

`make github-api` runs two live, read-only tests against issue `lightapi/light-portal#725` and its comments (`page=1&per_page=30`). The lane also runs in `make all`, after API Gateway publication. Failures are not silently skipped.

Prerequisites: running Gateway with the GitHub REST API published, caller ACL permission, configured outbound PAT and verified upstream TLS. These tests never read/provision the PAT. They reuse the API Gateway publication lane's Portal authentication state and login setup, including its `API_GATEWAY_E2E_*` settings and `LIGHT_PORTAL_ENV_FILE` convention.

- `GITHUB_API_GATEWAY_URL`: HTTPS Gateway origin, default `https://localhost` (separate from the UI login URL on port 3000).
- `GITHUB_API_CA_FILE`: Gateway CA bundle, default the sibling canonical `portal-config-loc/all-in-lt/light-gateway-rust/config/ca.pem`.
- `API_GATEWAY_E2E_AUTH_STATE_FILE`: optional existing Portal state file; default `.playwright-auth/api-gateway-publication/state.json`.

The Gateway reads always validate certificate chains and hostnames, even when the existing UI login uses `TLS_INSECURE`. Redirects are not followed, responses are limited to 1 MiB, and traces/videos/screenshots are disabled to keep caller headers out of artifacts. Reports: `reports/github-api/junit.xml`.

These two checks depend on live GitHub availability and configured credentials. They do not establish private-repository scope, write access, ACL denial or workflow/G03 behavior.
