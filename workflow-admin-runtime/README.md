# Workflow admin runtime fixtures

These files are declarative fixture specifications. They are not executable tests by themselves. They describe state that a deployment driver must establish through supported Workflow/Gateway starts and prohibit direct SQL setup, model calls, GitHub writes, and unbounded waits. `contract` mode validates only their deterministic structure and does not qualify baseline or restored runtime behavior.

No deployment driver is included in Phase 0 yet. Baseline and restored qualification therefore remain open. Live execution requires an executable driver named by `WORKFLOW_ADMIN_FIXTURE_DRIVER`. The driver receives `--fixture <absolute fixture.json> --mode baseline|restored --evidence <output.json>` and must use the supported deployment ingress. It must return nonzero for missing/skipped assertions or timeouts and write sanitized machine-readable evidence. Database queries may verify state after supported starts; they may not create or repair it.

The normative CLI, exit-code, atomic-output, evidence-schema, and required-assertion contract is documented in `implementation/light-portal/workflow-admin-runtime/phase0/README.md`. When the driver lands, baseline mode must also become a PostgreSQL-backed CI job; contract-only `make validate` intentionally does not claim runtime qualification.

`assigned-ask` must prove assignment creation, authorized Portal visibility, claim/release/complete behavior, and exactly one continuation. Its ROLE assertions remain blocked until the authority freshness dependency in the Phase 0 permission matrix is implemented; the driver reports that as a failing assertion rather than skipping it.

`between-stage-vm` must prove completed stage invocations, no running invocation, retained VM reservation, feature discovery, version-fenced feature cancellation, and positive release evidence. Cancellation acceptance alone is insufficient.
