# Issue #380 — built-in stateless support

`make mcp`: **45/45 passed** with `networknt/light-gateway:2.3.5-dev.mcp380`
on local all-in-lt, without `MCP_ROUTER_PROTOCOLS_STATELESS_ENABLED`.
The removed configuration field is rejected. Router tests: 210 passed, four
ignored; gateway MCP tests: six passed, one ignored. `make validate` passed.
The enablement workaround below is historical and has been removed.

# Latest correction — 2026-09-10 UTC

`make mcp`: **45/45 passed** after deploying
`networknt/light-gateway:2.3.5-dev.mcp-daily-fix`.

- Persisted `MCP_ROUTER_PROTOCOLS_STATELESS_ENABLED=true` in canonical all-in-lt
  Compose; removal of the temporary override had removed its only enablement.
- Corrected duplicate POST-header classification to select the modern -32020
  envelope after bounded body parsing. 210 gateway MCP tests pass (four ignored).
- Corrected the test reader to flatten March JSON-RPC batch arrays inside SSE
  events; regression added. This was a test-parser issue with the updated server.
- Updated the normal local `LIGHT_GATEWAY_IMAGE` selection; no test Compose
  override is needed. The demo already runs the updated implementation.

The initial failures below are historical, not the current live result.

# Initial daily-lane qualification — 2026-09-09

- `make validate`: passed (shell syntax, Node checks/tests and Playwright
  discovery). Modified shell scripts additionally passed Docker ShellCheck 0.9.0.
- `make mcp-source`: passed all seven source suites: client 17, gateway MCP 209,
  controller WebSocket 77, registry client 28, insurance 7, OAuth 20 and Portal
  schema/publication 22. Five upstream tests remain ignored (four gateway, one
  OAuth database test); ignored tests are not counted as qualified.
- `make mcp`: **36/45 passed**, nine failed against the existing local images.
- `make all ALLOW_BILLABLE_TESTS=false`: verified batch integration and failure
  propagation. It stopped at the same nine MCP failures before downstream LLM
  phases; this is not a full make-all pass.

Running images during this test:

| Service | Image | Image ID |
|---|---|---|
| Gateway | networknt/light-gateway:2.3.5-dev.mcp379-r6 | sha256:8ff151f484181ba12aae3d555251330c452cf3b2d3dd528e2d2391f31b2a060e |
| Insurance | networknt/demo-insurance-claim-mcp-server:2.3.5-dev.mcp379 | sha256:cb95607ce0605243361500abaac5f6b962c084deaa638bccab4e244f7e9409c2 |

Failures intentionally remain failures:

- Seven direct-demo cases expose previously fixed but not deployed behavior:
  encoded names, four malformed-capability metadata cases, duplicate protocol
  header and missing protocol header.
- Headerless March batch still returns 400 from the deployed gateway. The source
  regression for the corrected behavior passes.
- Duplicate version headers at the gateway return -32600 with null ID, rather
  than the expected modern -32020. This needs transport-path review; a source
  suite pass does not prove this deployed ingress contract.

The shared browser login helper was also corrected to accept Portal's current
“Account menu” label as well as the older “Open profile menu” label. Actual login
then succeeded without changing credentials or using an expired fixture.

Legacy DELETE 405 is accepted as the protocol's explicit refusal to terminate
sessions. Unknown-session POST must still return 404. Successful DELETE must be
followed by 404. No active server configuration, tool publication or deployment
was changed to obtain these results.

Live reports are generated under ignored `reports/mcp/` and
`reports/runs/<run>/mcp/`; source logs are under `reports/mcp-source/`.
