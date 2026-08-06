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
`https://localhost` continues to address `portal-config-loc` on Linux.

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
PORTAL_BASE_URL=https://localhost
TOKEN_PROFILE=portal-admin
LLM_PUBLIC_ALIAS=assistant-dev
TLS_INSECURE=true
```

An exported `PORTAL_ACCESS_TOKEN` overrides the committed profile when a fresh
or ad hoc token is useful. Environment variables override values loaded from
the file.

## Running tests

```bash
make validate
make smoke
make llm
make functional
```

Run validation, functional tests, a short repeated run, and the non-billable
models performance test in one batch:

```bash
make batch
```

`make all` is an alias for `make batch`. The batch deliberately skips the
billable LLM performance workload unless it is explicitly enabled. The normal
functional and repeated chat cases still call the configured provider; the
default batch performs one functional pass followed by three repeated passes.

```bash
make batch ALLOW_BILLABLE_TESTS=true VUS=1 DURATION=30s
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

Run a deliberately small live-provider completion workload:

```bash
make perf-live ALLOW_BILLABLE_TESTS=true VUS=1 DURATION=30s
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
