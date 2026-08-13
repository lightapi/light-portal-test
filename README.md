# light-portal-test

Black-box functional and performance tests for Light Portal deployments. The
initial target is `portal-config-loc`; tests are organized so additional
environments and feature areas can be added without changing the command-line
interface.

## Test lanes

- Hurl runs functional HTTP tests and repeated smoke tests.
- k6 runs controlled smoke, performance, soak, and later WebSocket workloads.
- Browser tests are intentionally deferred until a Portal UI scenario requires
  them.

Live LLM tests call billable providers. The ordinary functional lane sends only
a small number of requests. Performance tests that generate completions require
an explicit `ALLOW_BILLABLE_TESTS=true` opt-in.

## Prerequisites

- Podman or Docker; the runners automatically use pinned Hurl and k6 images.
- Alternatively, install [Hurl](https://hurl.dev/docs/installation.html) and
  [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) natively. Native
  binaries take precedence over containers.
- Bash, `curl`, and `jq`

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

An exported `PORTAL_ACCESS_TOKEN` overrides the committed profile when a fresh
or ad hoc token is useful. Environment variables override values loaded from
the file.

## Running tests

```bash
make validate
make smoke
make llm
make workflow-mcp
make functional
```

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
