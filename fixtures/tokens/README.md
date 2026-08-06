# Public development JWT fixtures

These JWTs are intentionally public test fixtures for `portal-config-loc` and
development installations created by `light-portal-install`. The corresponding
users are public test users and can obtain equivalent live tokens by signing in
to those environments.

The fixtures must not be configured as credentials for production or other
non-development deployments. Add one file per logical test identity and record
its expected non-secret claims in `manifest.json`.

Select a fixture with `TOKEN_PROFILE`:

```bash
make functional TOKEN_PROFILE=portal-admin
```
