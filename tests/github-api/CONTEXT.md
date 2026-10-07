# Context-only GitHub acceptance

The existing `make github-api` / `make all` lane runs offline oracle checks,
the original six Gateway reads, and the original API-only UI workflow test.
Context workflows and full dispatch-observer qualification are optional checkpoint
lanes. Discovery is not live proof, and skipped context cases are not qualification.

With no checkpoint settings, the two context cases are skipped and Gateway reads
retain their response, authentication and correlated ACL/audit checks without
requiring a dispatch build-identity receipt. They do not claim independent
non-dispatch qualification.

Set `GITHUB_CONTEXT_E2E_ENABLED=true` to require context qualification and
`GITHUB_API_DISPATCH_QUALIFICATION_ENABLED=true` to require the full dispatch
matrix. Missing prerequisites then fail explicitly. Supplying any required context
setting or `GITHUB_API_DISPATCH_IDENTITY_FILE` also enables its corresponding
lane automatically, preserving existing checkpoint scripts. Set the respective
flag to `false` to explicitly select the ordinary lane even with checkpoint
settings in the environment. Invalid flag values fail.

Configure these using the established private `LIGHT_PORTAL_ENV_FILE` convention
or environment overrides; never place credentials or storage state in Git:

- `GITHUB_CONTEXT_DEFINITION_ID`, `GITHUB_CONTEXT_TOOL_NAME`: the separately
  published `github-issue-context / 0.1.0` and its approved workflow-backed Tool.
- `GITHUB_CONTEXT_HOST_ID`: optional, defaults to the established localhost host.
- `GITHUB_CONTEXT_EMPTY_ISSUE_URL`, `GITHUB_CONTEXT_PAGED_ISSUE_URL`: existing
  canonical GitHub issue URLs, respectively zero and 31–270 stable comments.
  The owner selected `https://github.com/networknt/light-fabric/issues/415` and
  reported 104 comments. Count and context size still require current readback.
- `GITHUB_CONTEXT_GATEWAY_RECEIPT`: a trusted owner/qualification JSON receipt
  for the running Gateway binary and cache. It requires `binarySha256`,
  `cacheSha256`, `aclBeforeCredentialInjection`, `independentNonDispatch`,
  `jwtExpiryEnforced`, `hostnameVerified`. Booleans must be true and must be backed
  by correlated build/configuration/probe evidence. This file is evidence, not a
  mechanism to enable or bypass controls. No qualifying receipt currently exists.
- `GITHUB_CONTEXT_EVIDENCE_DIR`: optional append-only receipt parent directory.
- `GITHUB_API_REPORT_DIR`: optional report parent. Every discovery/execution
  allocates its own directory, including JUnit/results/artifacts. Success receipts use distinct UUID directories outside
  Playwright's disposable artifacts and are never automatically deleted.

The lane reads current definition/binding authority using bounded SELECT-only
Docker/PostgreSQL access, following the existing Gateway provenance helper.
It requires exact equality to the retained qualified definition, explicit caller
policy/admission limits, both new-binding GET targets, enabled v2 admission,
and finite bounds no larger than isolated qualification. Caller admission and
runtime eligibility are also exercised by the actual authenticated Tool call.

Portal workflow-backed Tools currently require **sync** bindings and clamp the
deadline to **30000 ms**. `workflow_start` / Test Runner cannot select binding
bounds: its current native path uses a 30-day deadline and default budgets.
The context lane therefore invokes the published Tool once through BFF `/mcp`;
it does not use Test Runner, direct `workflow_invoke`, or a fabricated internal
authority. The 30-second proposal is tighter than the isolated five-minute async
binding; the worst-case 33-attempt retry fixture does not fit that deadline.
Owner disposition and actual admission/live proof remain prerequisites.

Each case records its outgoing JSON-RPC/correlation request identity before
Invoke, polls for the actual accepted instance while the synchronous response is
pending, and saves acceptance immediately when visible. On uncertain delivery it
reads the same correlation and accepted instance; it never resends Invoke. A
missing/ambiguous receipt fails, retaining the request identity for manual recovery.
Polling, comparison GETs, response size and test time are finite. At most 44
comparison GETs cover both cases at maximum pagination, with no HTTP retries.

Successful executor pages and their persisted IDs are compared against bounded
before/after GET snapshots. Null fields, decimal IDs, order, deduplication,
terminal empty-page logic, exact context/public output, returned status output,
attempt counters and settled ledger bounds are checked. A source edit fails as
inconclusive completeness; before/after equality is not an atomic GitHub snapshot.
Persisted nested-call and cost counters are not HTTP-call/model-spend meters.

Offline verification:

```sh
rtk node tests/github-api/context-support.test.mjs
rtk ./node_modules/.bin/playwright test -c playwright.github-api.config.js --list
```

After all prerequisites and the binding disposition are resolved, use a fresh
report directory and the existing runner, selecting `context-workflow.spec.js`
for the two bounded live cases. Full `make all` requires separate authorization
for its model/billable, MCP/publication and other mutating lanes. Do not run it
under context-only authorization, even with billable tests disabled.

No cleanup mutation is needed: these tests create no disposable Portal authority.
Retain publication/binding authority and successful receipts for repeatability.
Retire/revoke only newly created context authority through supported Portal
operations when explicitly rolling back; preserve the API-only workflow and design
candidate and never delete projection rows, process history, or acceptance receipts.
