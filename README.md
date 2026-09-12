# light-portal-test

Black-box functional and performance tests for Light Portal deployments. The
initial target is `portal-config-loc`; tests are organized so additional
environments and feature areas can be added without changing the command-line
interface.

## Test lanes

- Hurl runs functional HTTP tests and repeated smoke tests.
- `make mcp` runs the non-billable daily MCP protocol suite, also included in
  `make all`. See [MCP coverage and setup](tests/mcp/README.md).
- `make mcp-source` runs the complementary sibling-repository regression tests.
- k6 runs controlled smoke, performance, soak, and later WebSocket workloads.
- Playwright runs the promotion UI canary in a real Chromium browser.

Live LLM tests call billable providers. The ordinary functional lane sends only
a small number of requests. Performance tests that generate completions require
an explicit `ALLOW_BILLABLE_TESTS=true` opt-in.

## Prerequisites

- Podman or Docker; the runners automatically use pinned Hurl and k6 images.
- Alternatively, install [Hurl](https://hurl.dev/docs/installation.html) and
  [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) natively. Native
  binaries take precedence over containers.
- Bash, `curl`, and `jq`
- Node.js 20 or newer for the Playwright promotion lane

The default container images are:

```text
ghcr.io/orange-opensource/hurl:8.0.1
grafana/k6:2.0.0
```

Override them with `HURL_IMAGE`, `K6_IMAGE`, or select a specific runtime with
`CONTAINER_ENGINE=podman|docker`. Container execution uses host networking so
`https://localhost:8444` addresses the dedicated `llm-gateway` service in
`portal-config-loc` on Linux.

## Configuration

The repository includes intentionally public JWT fixtures for the public
development users described in [fixtures/tokens/README.md](fixtures/tokens/README.md).
The default profile is `portal-admin`, so the initial LLM tests run without
copying a token into an environment file.

The runners also load `${LIGHT_PORTAL_ENV_FILE}` when set, otherwise they load:

```text
~/.config/lightapi/light-portal.env
```

The environment file is optional. Use it to override non-secret defaults or to
select another committed token profile:

```bash
cp config/portal-config-loc.env.example ~/.config/lightapi/light-portal.env
```

If the file already contains provider keys, preserve them. Provider keys are
server-side credentials and are not consumed by this test suite.

Required test configuration:

```bash
PORTAL_BASE_URL=https://localhost:8444
MCP_BASE_URL=https://localhost
TOKEN_PROFILE=portal-admin
LLM_PUBLIC_ALIAS=assistant-dev
EMBEDDING_QUERY_ALIAS=kb-query
EMBEDDING_INDEX_ALIAS=kb-index
EMBEDDING_SPACE_ID=nvidia-nemotron-3-embed-1b-float-v1
EMBEDDING_SPACE_REVISION=1
EMBEDDING_DIMENSION=2048
TLS_INSECURE=true
WORKFLOW_SMOKE_TOOL=workflow_mcp_smoke
CUSTOMER_360_TOOL=customer_360
```

When `PROMOTION_E2E_EMAIL` and `PROMOTION_E2E_PASSWORD` are configured, the
runners authenticate through the Portal UI and use the resulting access token
without writing it to the environment file. A cached browser token is reused
only while it has at least five minutes remaining; otherwise the runner signs
in again. Set `PORTAL_AUTO_LOGIN=false` to disable this behavior or adjust the
margin with `PORTAL_TOKEN_MIN_TTL_SECONDS`.

Without UI credentials, an exported `PORTAL_ACCESS_TOKEN` overrides the
committed profile when a fresh or ad hoc token is useful. Environment variables
override values loaded from the file.

## Running tests

```bash
make validate
make smoke
make llm
make workflow-mcp
make functional
```

## Promotion automation

Promotion testing combines a read-only Hurl preflight with a real browser
journey. The browser promotes one configured Platform, Pipeline, and Product
Version in dependency order, waits for each target projection to complete,
rechecks the durable projection evidence, and verifies that a repeated execute
is an idempotent replay. A separate browser case verifies that **Select all N
matching records** spans server-side pagination instead of selecting only the
visible ten-row page.

The suite never creates rows directly in projection tables. Create and update
canary records through Portal commands or the corresponding admin pages.

### Canary prerequisites

Use a dedicated source/target host pair. The automation user needs `portal.w`
and host-admin access to both hosts. The source needs:

- at least 11 active records of the configured pagination canary type (Config
  by default), so server-side selection crosses the default ten-row page;
- one uniquely identifiable Platform;
- one Pipeline whose dependencies exist in the target after Platform
  promotion; and
- one Product Version whose Platform and Pipeline dependencies exist in the
  target after the first two promotions.

Add the following values only to the private environment file selected by
`LIGHT_PORTAL_ENV_FILE` (by default
`~/.config/lightapi/light-portal.env`):

```bash
PROMOTION_UI_BASE_URL=https://localhost:3000
PROMOTION_API_BASE_URL=https://localhost:3000
PROMOTION_SOURCE_HOST_ID=<source-host-uuid>
PROMOTION_SOURCE_HOST_LABEL='source-domain / source-subdomain'
PROMOTION_TARGET_HOST_ID=<target-host-uuid>
PROMOTION_TARGET_HOST_LABEL='target-domain / target-subdomain'
PROMOTION_PLATFORM_MATCH='unique visible platform text'
PROMOTION_PIPELINE_MATCH='pipeline name shown in the Pipeline table'
PROMOTION_PIPELINE_VERSION='pipeline version shown in the Pipeline table'
PROMOTION_PRODUCT_ID='product ID shown in the Product Version table'
PROMOTION_PRODUCT_VERSION='version shown in the Product Version table'
PROMOTION_SELECTION_ENTITY_TYPE=config
PROMOTION_SELECTION_ENTITY_LABEL=Config
PROMOTION_E2E_EMAIL=<dedicated-test-user>
PROMOTION_E2E_PASSWORD=<secret>
PROMOTION_E2E_USER_TYPE=Employee
```

The host labels must exactly match the Portal select options. The Platform
match must identify exactly one visible row. Pipeline uses its visible name
plus version as a composite identity, and Product Version uses the visible
Product ID plus Version. Do not use hidden UUIDs for either entity.

Install the pinned test dependency and browser once:

```bash
npm ci
npx playwright install chromium
```

The P4-P6 lifecycle assertions call
`lightapi.net/user/promotionRecovery/0.1.0`. A preserved local database must
contain both the endpoint registration and its portal gateway access-control
rule. Apply events 13 and 14 from `event-importer/events/local/README.md`,
publish a new current `loc` portal-gateway snapshot, and restart
`light-gateway` before running this suite.

Run the lanes with:

```bash
make promotion-api
make promotion-ui
make promotion-hourly
```

`promotion-api` validates history access and exports the configured Platform,
Pipeline, and Product Version without modifying the target; it requires a
current `PORTAL_ACCESS_TOKEN`. `promotion-ui` authenticates with the configured
browser user and performs the browser journey. `promotion-hourly` always runs
the browser lane and, in the default `PROMOTION_API_PREFLIGHT=auto` mode, runs
Hurl only when an explicit access token is configured. Use `required` to make
Hurl mandatory or `skip` to disable it. Reports are written below a timestamped
`reports/runs/` directory.

The scheduled canary does not clean the target host before or after promotion.
It executes with `orphanAction: keep`, so target-only records are preserved.
On subsequent runs, an unchanged source/target entity is planned as `NOOP` and
no new event is appended; changed mutable fields are promoted as updates. The
suite also replays the same completed plan once to verify its idempotent result.

For a local interactive login, omit `PROMOTION_REUSE_AUTH_STATE` and provide
the test email/password. For an unattended runner, either keep those secrets
in its secret store or mount a short-lived Playwright state file and set:

```bash
PROMOTION_AUTH_STATE_FILE=/run/secrets/portal-playwright-state.json
PROMOTION_REUSE_AUTH_STATE=true
```

The authentication state contains reusable cookies. Never commit it or publish
it as a test artifact. Playwright tracing is disabled because traces can also
capture authenticated cookies and request headers.

### Scheduler-triggered runner

The asynchronous runner lets `light-workflow` trigger the suite without
waiting for the complete browser run:

```bash
PROMOTION_RUNNER_BEARER_TOKEN=<secret> make runner
```

Its API is:

```text
GET  /healthz
POST /test-runs
GET  /test-runs/{runId}
```

Example trigger:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $PROMOTION_RUNNER_BEARER_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: promotion-hourly-2026-08-28T20' \
  --data '{"suite":"promotion-hourly","correlationId":"promotion-hourly-2026-08-28T20"}' \
  http://127.0.0.1:8090/test-runs
```

The call returns HTTP 202 with a `runId`. Only one promotion run is admitted at
a time so overlapping schedules cannot mutate the canary target concurrently.
Repeated calls with the same idempotency key return the original run.

For deployment, build `Dockerfile.playwright` and mount the private environment
file or inject its values from the platform secret store. A non-loopback runner
refuses to start unless a bearer token is configured or
`PROMOTION_RUNNER_TRUST_WORKFLOW_HEADERS=true` is explicitly selected. The
latter mode requires both workflow Authorization headers and must only be used
on a network where direct access is restricted to `light-workflow`.

The workflow example is
[`examples/workflows/promotion-hourly.yaml`](examples/workflows/promotion-hourly.yaml).
Register its `promotion-test-runner` endpoint target with POST permission, then
have Portal Scheduler invoke the workflow with a unique `correlationId` hourly
or daily. The workflow receives HTTP 202 immediately; test completion and
failure alerting are owned by the runner/monitoring system.

The `workflow-mcp` lane verifies discovery and invocation of the synchronized
`workflow_mcp_smoke` and `customer_360` tools. It also verifies that the smoke
tool rejects missing required input. The default MCP endpoint is
`https://localhost/mcp`; override `MCP_BASE_URL` when the development
installation publishes light-gateway at another origin. These tests assume the
Portal events and gateway configuration for both tools have already been
synchronized into the target `portal-config-loc` or `light-portal-install`
environment.

Test the published NVIDIA embedding query and indexing Aliases through the
gateway with two bounded requests:

```bash
make embeddings ALLOW_BILLABLE_TESTS=true
```

This lane checks `kb-query` and `kb-index` independently, including the
declared embedding-space response headers and the 2048-value vector dimension.
It calls the gateway only; `NVIDIA_API_KEY` remains a server-side gateway
secret and is never read by this repository. Override any Alias or contract
value with the corresponding `EMBEDDING_*` variable when testing another
publication. If the embedding Aliases are bound to dedicated principals, set
`EMBEDDING_QUERY_ACCESS_TOKEN` and `EMBEDDING_INDEX_ACCESS_TOKEN` to gateway
caller tokens for `knowledge-service` and `knowledge-indexer`, respectively.
The tokens are passed to Hurl as secret variables and never as command-line
arguments. Each falls back to the ordinary Portal test token when omitted.

Run validation, functional tests, a short repeated run, and the non-billable
models performance test in one batch:

```bash
make batch
```

The batch deliberately skips the billable LLM performance workload unless it
is explicitly enabled. The normal functional and repeated chat cases still
call the configured provider; the default batch performs one functional pass
followed by three repeated passes.

```bash
make batch ALLOW_BILLABLE_TESTS=true VUS=1 LLM_ITERATIONS=10
```

Run every test lane, including the billable LLM performance and embedding
tests, with one command:

```bash
make all
```

Calling `make all` is the explicit billable-test opt-in; no additional variable
or command-line switch is required. An explicit opt-out is honored and skips
the gated LLM performance and embedding lanes:

```bash
make all ALLOW_BILLABLE_TESTS=false
```

Select a different committed identity with:

```bash
make functional TOKEN_PROFILE=another-profile
```

Override the configured alias to exercise another published model:

```bash
make llm LLM_PUBLIC_ALIAS=another-public-alias
```

Repeat the smoke and LLM cases 20 times with a ten-second pause:

```bash
make repeat COUNT=20 INTERVAL=10
```

Each attempt gets its own Hurl JSON and JUnit report. At completion, the runner
writes `summary.json` with pass/fail counts plus overall and per-test p50, p95,
and maximum latency. Configure the performance signal with milliseconds:

```bash
make repeat COUNT=20 REPEAT_WARN_P95_MS=10000 REPEAT_FAIL_P95_MS=30000
```

Crossing the warning threshold prints `WARNING` but exits successfully.
Crossing the failure threshold, or any failed functional attempt, exits
nonzero so a CI job can send its normal failure notification. This repository
does not directly send email or chat notifications.

Run continuously until the first failure:

```bash
make repeat COUNT=0 INTERVAL=30
```

Use `STOP_ON_FAILURE=false` to collect all requested attempts even after an
individual failure.

Run a non-billable `/v1/models` performance smoke test:

```bash
make perf-smoke VUS=2 DURATION=30s
```

Run a deliberately small live-provider completion workload. The default uses
one VU to execute exactly ten requests; increasing `VUS` changes concurrency,
not the total request count:

```bash
make perf-live ALLOW_BILLABLE_TESTS=true VUS=1 LLM_ITERATIONS=10
```

Reports are written below timestamped directories in `reports/runs/` and are
ignored by Git. Direct `make smoke`, `make llm`, and performance commands keep
their reports in the corresponding top-level `reports/` directory.

## Adding tests

Put HTTP behavior tests in `tests/<feature>/*.hurl`. Keep each file independent
unless a sequence is the behavior under test. Use `{{base_url}}`,
`{{access_token}}`, and feature-specific variables rather than hard-coded
credentials or deployment IDs.

Put load tests in `performance/`. Every performance script must define explicit
thresholds and safe local defaults. Tests that can incur provider cost must be
invoked through the billable-test guard in `scripts/run-performance.sh`.

Every test should:

- use a unique correlation ID;
- have bounded timeouts;
- fail with a nonzero exit code;
- avoid logging credentials or complete provider responses;
- isolate and clean up data it creates;
- keep destructive and billable behavior opt-in.

## Continuous integration

GitHub-hosted runners cannot reach a developer's `portal-config-loc` instance.
The initial workflow validates repository structure and shell/JavaScript syntax
only. Runtime tests should run locally or on a self-hosted runner until the
complete Portal stack can be started ephemerally in CI.

## GenAI Chat browser smoke test

`npm run test:chat` exercises the real `/app/genai/chat` UI: Portal login,
Tech Support Agent selection, WebSocket session admission, message submission,
turn acceptance, an LLM reply containing a unique per-run marker, and rendering
of that reply. It fails on Agent error frames (including session-limit errors
and gateway 403), rather than counting a successful socket upgrade as success.
No backend or model is mocked. Each run can incur one model request; retries
are disabled. This is a functional smoke test, not a concurrency/load test.

```bash
npm ci
npx playwright install chromium
export CHAT_E2E_EMAIL='steve.hu@lightapi.net'
read -rsp 'Portal password: ' CHAT_E2E_PASSWORD; echo
export CHAT_E2E_PASSWORD
npm run test:chat
```

Defaults target `portal-config-loc/all-in-lt`: UI `https://localhost:3000`,
agent option `Tech Support Agent Dev · dev`. Override with `CHAT_UI_BASE_URL`
and `CHAT_AGENT_LABEL` (exact visible option label). Alternatively set
`CHAT_AUTH_STATE_FILE` to an existing, unexpired Playwright Portal storage-state
file; an API bearer token alone is not a browser login. Credentials are never
checked into the test. Local self-signed browser certificates are accepted by
default; use `TLS_INSECURE=false` with trusted certificates.

The suite disconnects in `finally` and retains only its scoped session IDs in
`.playwright-auth/chat-session.json` (ignored, mode 0600) for reuse across runs.
Disconnect does not end the durable server session. Do not run concurrent copies
against the same session file. Set `CHAT_SESSION_FILE` for a dedicated test
identity; remove that file to start fresh after session expiry or a policy
replacement. Existing sessions then expire under the Agent's normal policy.
The test does not modify policy, delete database rows, or hide failed resumes.

List without contacting the deployment: `npm run test:chat:list`.
JUnit and failure artifacts are under `reports/genai-chat/`. Traces and videos
are disabled to avoid recording authentication handshakes. A pass requires a
working gateway binding, model route, provider credential, and provider capacity;
publication or connectivity failures deliberately fail this test.

Run the Chat UI suite through Make, like `make promotion-ui`:

```bash
make genai-chat-ui
```

The Make wrapper loads `LIGHT_PORTAL_ENV_FILE` (default:
`~/.config/lightapi/light-portal.env`). Set `CHAT_E2E_EMAIL` and
`CHAT_E2E_PASSWORD` there, or supply `CHAT_AUTH_STATE_FILE`. For convenience it
also accepts the existing `PROMOTION_E2E_EMAIL` / `PROMOTION_E2E_PASSWORD`
credentials and `PROMOTION_UI_BASE_URL` when the corresponding Chat settings
are absent. Explicit Chat environment overrides take precedence.

`make all` now runs this suite after the existing batch and embedding suites.
Failures propagate to Make. As with other optional billable checks,
`make all ALLOW_BILLABLE_TESTS=false` skips the Chat UI suite; the explicit
`make genai-chat-ui` target runs it directly. Earlier suite failures stop
`make all` before Chat is reached. Reports remain in `reports/genai-chat/`.

### Claude personal worker E2E

`make claude-personal-e2e` runs the six-turn native Claude coding/review session
suite against `portal-config-loc/all-in-lt`, with readiness checks, overlap
protection, a timeout, and timestamped JSON/JUnit reports. It consumes native
subscription usage and is an explicit standalone target. See
[setup, configuration, coverage and daily scheduling](tests/claude-personal/README.md).
