# Local validation — 2026-10-01

The lifecycle lane passed through two separate invocations: one via the npm
script (49.6 seconds), followed by the Make target (52.1 seconds). Each invocation
completed two cycles against `portal-bff-loc`. The latter included the explicit
`noChanges` assertion for repeated retirement and the token-lifetime setup check.

Both invocations reused API version `01a0f84c-d508-75a0-9dbe-6fc89925030c`,
endpoint `01a0f84c-d51f-7583-a301-642ec179f886`, and Gateway association
`01a0f84e-0ed3-7ab8-9822-9b588506c902`. Each cycle restored the complete
baseline ACL maps and left `ACL_TEST_API` and version `1.0.0` inactive.
The snapshot identity stayed unchanged. This is UI and Portal projection evidence;
request-time Gateway enforcement was not exercised.

Shell/JavaScript syntax checks, test discovery, and `git diff --check` passed.
`make -n all` confirmed inclusion of `api-gateway-publication-ui`; the full
`make all` suite was not run for this change.

## Earlier fixture-name failure

An early development attempt submitted `PORTAL_ACL_LIFECYCLE_TEST`, exceeding
the database's 16-character API ID limit. The command accepted an event, but its
projection failed. No API row was created for that identity. The fixture now uses
`ACL_TEST_API` and validates the length before submission.

The rejected event remains unresolved in the local failure queue:

- Event: `01a0f848-78fb-7d7b-a12b-469c2e2cdb21` (`ApiCreatedEvent`).
- Failure: `d10a5016-f1df-4260-bcfb-708939986d74` (`PROJECTION_HANDLER_FAILED`).
- Aggregate: `01964b05-552a-7c4b-9184-6857e7f3dc5f|PORTAL_ACL_LIFECYCLE_TEST`.

The replay UI does not permit changing aggregate identity through an amendment,
and ordered failures cannot simply be waived. No event-store or projection rows
were edited to dispose of it. Successful fixture cleanup refers to projected
`ACL_TEST_API` records and does not resolve this earlier failed event.
