# Admin-managed Resend Credential Design

## Summary

Move only the Resend API key from startup environment configuration to the
existing ADMIN application-settings surface. Keep sender name/address unchanged.

## Approved Decision

- DB-only runtime authority under `email.resend_api_key`.
- AES-256-GCM encryption using the existing settings master key.
- Write-only API: configured state and masked suffix only.
- Blank preserves; explicit confirmed clear removes.
- Cache invalidation makes changes effective without restart.
- Production missing key fails honestly; development/test may simulate delivery.

## Alternatives Rejected

- Environment fallback: safer migration but contradicts the requested removal.
- Automatic environment import: silently persists secrets and complicates
  operations.

## Validation

Prove encryption, non-disclosure, preserve/replace/clear semantics, concurrent
cache invalidation, runtime hot reload, production missing-key failure, UI
accessibility, and responsive behavior.

## Open Questions

None.
