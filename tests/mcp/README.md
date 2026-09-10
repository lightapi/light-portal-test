# Daily MCP regression lane

Run `make mcp`, or use the usual `make all`.
See [qualification results](QUALIFICATION.md) for the latest live result and history. The batch runner executes MCP after
static validation and before the LLM/repeat/performance phases. MCP never calls
an LLM and runs even with `ALLOW_BILLABLE_TESTS=false`. Any failed case produces
a nonzero exit and fails the batch. Other existing make-all lanes still have
their own live-provider requirements.

The runner reuses `scripts/common.sh` for the private environment file, automatic
Portal login, current-token checks and token profiles. Do not copy credentials
into test files. Configure:

- `MCP_BASE_URL`: gateway origin (default `https://localhost`; runner adds `/mcp`).
- `MCP_DEMO_URL`: direct insurance endpoint (default `http://localhost:8087/mcp`).
- `TLS_INSECURE`: existing local TLS option; use `false` with trusted certificates.
- A current admin Portal token or existing automatic-login configuration.

The selected deployment must support the July-2026 stateless profile, retain all
three supported 2025 profiles, and publish the five insurance tools with admin
access and the stateless insurance backend. This lane deliberately fails when a
required service, published tool, revision or contract is missing. Stateless support is built in; no environment override is required. This lane does not
silently skip absent fixtures, change server configuration, publish tools, read
signing keys, mint replacement identities, or deploy containers. Use the normal
release/deployment process to install fixes; no temporary Compose file is needed.

## Coverage

- Gateway and demo discovery, catalog metadata and all five insurance tool calls
  using synthetic claims only; complete structured results and no modern sessions.
- Literal/equivalent encoded tool names; malformed/mismatched names.
- Missing/null/array/string capability metadata: -32602 without misleading data;
  valid empty-object capabilities succeed throughout positive requests.
- Protocol metadata mismatch, duplicate version headers, invalid Origin.
- Missing/invalid gateway bearer, 2024 retirement, unknown modern revision and
  supported-revision error data, stateless DELETE rejection.
- Concurrent stateless catalogs (bounded at 12 requests).
- March/June/November initialization, initialized notification, listing, DELETE,
  and 404 for unknown sessions and after supported session deletion. DELETE 405
  is an explicit permitted refusal, not a deletion success. March batches omit the post-March version
  header and preserve both response IDs. Sessions are cleaned up in finally.
- Direct demo missing-version header classification.

`reports/mcp/results.json` and `reports/mcp/junit.xml` contain case outcomes and
safe diagnostics. Batch runs use `reports/runs/<run>/mcp/`. Reports exclude raw
request/response bodies, bearer tokens and session identifiers. Each request has
a 20-second deadline and a 4-MiB response limit; a failed case does not suppress
independent cases. Node 20+ is required. `make validate` checks syntax and tests
the JSON/SSE report reader without requiring the deployment.

## Source-level complement

`make mcp-source` runs the authoritative tests in sibling `light-fabric`,
`light-example-rs`, `portal-service`, `light-portal` and `controller-rs` repositories (override
`MCP_SOURCE_WORKSPACE` if needed). It requires Rust/Cargo, Maven and the Java
version required by light-portal. Logs go to `reports/mcp-source/` and command
failures propagate. It covers credential-cache eviction/concurrency, no replay,
SSE completion before EOF, parameter-header schemas/values, policy reload and
cached authorization, parser mutation corpus, OAuth resource registration and
Portal publication edge cases, controller WebSocket flows and the Portal registry
client. Ignored upstream tests remain explicitly ignored
in those logs; this target does not claim their database prerequisites were run.

This source target is separate from `make all`, which remains a deployment-facing
suite usable without sibling source checkouts. To run both daily:

```sh
make mcp-source && make all
```

Earlier R6 qualification also used dedicated OAuth-protected replicas, registered
OAuth clients, multi-replica legacy affinity checks, pinned external conformance,
and rollback exercises. These require isolated deployment setup and are not
claimed by the daily lane. The daily tests do not weaken expiry/issuer/audience
checks to accommodate local config, nor claim full MCP specification coverage.
