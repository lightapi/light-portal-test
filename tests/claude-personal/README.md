# Claude personal deployed E2E

Run on the host that owns the enrolled Claude runner and its native login. This
suite targets the existing `portal-config-loc/all-in-lt` deployment; it does not
build, deploy, restart, enroll, publish policy, or change CLI permissions.

```bash
python3 -m venv .venv-claude-e2e
.venv-claude-e2e/bin/pip install -r tests/claude-personal/requirements.txt
make claude-personal-e2e
```

Invoking this target explicitly authorizes native subscription usage. It is not
included in `make all`. The suite creates a temporary Git repository and performs
six turns: implement new/resume, review new, implementation refresh, review
resume-and-close, and implementation close. It checks conversation markers,
review of the updated candidate, fenced database receipts, ignored build output
exclusion, and independently runs immutable tests on the reconstructed patch.
The test originates at Agent WebSocket admission, not the Workflow engine.
Gateway bypass is not asserted: global gateway audit counts are unreliable on a
shared daily deployment, and request-correlated audit verification is not yet
implemented. The original qualification smoke remains in light-fabric for its
quiet-stack audit check.

Configuration loads from `LIGHT_PORTAL_ENV_FILE` (default
`~/.config/lightapi/light-portal.env`); explicit `CLAUDE_E2E_*` environment values
win. Never put tokens into the Makefile or report configuration.

| Variable | Default |
| --- | --- |
| `CLAUDE_E2E_PYTHON` | `.venv-claude-e2e/bin/python` when installed, otherwise `python3` |
| `CLAUDE_E2E_RUNTIME` | sibling `portal-config-loc/all-in-lt/light-workflow-runner-claude-personal/.runtime` |
| `CLAUDE_E2E_URL` | `ws://127.0.0.1:8090/chat` |
| `CLAUDE_E2E_TIMEOUT` | 900 seconds |
| `CLAUDE_E2E_REPORT_ROOT` | `reports/claude-personal` |
| `CLAUDE_E2E_DISTRIBUTION` | runtime's grandparent, normally `all-in-lt` |
| `CLAUDE_E2E_LIFECYCLE` | sibling `portal-config-loc/scripts/personal-runner-lifecycle.py` |
| `CLAUDE_E2E_CONTAINER_ENGINE` | `docker` |
| `CLAUDE_E2E_DB_CONTAINER` | `postgres` |
| `CLAUDE_E2E_DB_USER` | `postgres` |
| `CLAUDE_E2E_DB_NAME` | `operations` |
| `CLAUDE_E2E_RUNNER_ID` | `personal-claude-runner` |
| `CLAUDE_E2E_MODEL` | `sonnet` |

Dependencies include Git, container access for read-only receipt queries, the
Python requirements, and the enrolled runtime's `service.jwt`,
`coding-profile.json`, and repositories directory. Existing lifecycle checks
validate configured personal runners, credentials, pins, and Controller
connectivity. Consequently, an unhealthy enrolled Codex runner also blocks this
preflight. No credential renewal is performed automatically.

Each invocation writes a private timestamped directory containing `result.json`,
`junit.xml`, and `private.log`; successful runs also write `evidence.json`.
Exit 0 means passed, 1 test failure, and 2 blocked prerequisites. The runtime lock
prevents overlapping executions of this target across report directories.
Timeout kills the test process group, not the shared runner service. Success
closes both conversations and removes the fixture. Failure can retain native
sessions/checkpoints or temporary artifacts; inspect the private log/runtime
before retrying. Do not automatically replay uncertain turns or delete native
history. Reports may contain model output; retain privately and prune according
to your local retention policy.

For daily execution, use a host user timer or cron with the absolute checkout and
Python paths, for example (02:00 local time):

```cron
0 2 * * * cd /absolute/workspace/light-portal-test && CLAUDE_E2E_PYTHON=/absolute/workspace/light-portal-test/.venv-claude-e2e/bin/python make claude-personal-e2e
```

The existing HTTP promotion runner does not yet dispatch this suite. No schedule
is installed by this change. Run harness regressions without native usage with:

```bash
python3 -B -m unittest discover -s tests/claude-personal -p 'test_*.py'
```
