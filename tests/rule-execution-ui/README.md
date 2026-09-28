# Local Rust rule execution

Use the local Portal at `https://localhost:3000` with an `admin` user, such as
the account you verified. The Rule Admin UI also accepts `access-admin`, but
the `RunRuleTestCase` handler independently requires `admin`, `rule-admin`,
or `rule-viewer`. Open **Rule Admin**, select an existing CEL rule, and
choose **Details**. Under **Test Cases**, add a case with `executorType` set
to `rust` (or `both`), `testMode` set to `conditions`, an `inputContext` that
matches the rule expression, and the corresponding `expectedResult`. Run it
from the Test Cases table. A successful response has `success: true` and
`executorResults.rust.success: true`; the Rust result should have no `error`.

The automated test can create and reuse its own CEL rule and Rust test case
through Portal commands. It defaults to the local host ID; set
`RULE_E2E_HOST_ID` if your target uses another host. To run against a case
you created manually, set both `RULE_E2E_RULE_ID` and `RULE_E2E_TEST_ID`.
Supply an
`admin` login through `RULE_E2E_EMAIL` and `RULE_E2E_PASSWORD`, or
set `RULE_E2E_AUTH_STATE_FILE` to a current Playwright storage-state file.
The existing generic `.playwright-auth/state.json` lacks Rule Admin access.

Run `make rule-execution-ui` from the repository root. `make all` includes
the same target. The runner reads the private
`LIGHT_PORTAL_ENV_FILE` (default `~/.config/lightapi/light-portal.env`) and
allows explicit environment variables to override it. The test opens
Rule Admin, selects the fixture, clicks **Run**, and checks the Portal query
response and rendered result. `RULE_E2E_BASE_URL` changes the UI target;
the default is the local Portal.
