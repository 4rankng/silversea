# Docs Assessment: Company Info Access and Dashboard Banner

## Summary

This change does affect durable documentation. The company-info route is now
available to office staff, not just ADMIN, and the dashboard now surfaces a
setup reminder when company-info is incomplete. Those are user-visible workflow
changes, so I updated the existing regression docs rather than creating a new
doc.

## Docs Updated

- [docs/regression-testing/README.md](/Users/dev/Documents/projects/silversea/docs/regression-testing/README.md)
  - Added `/config/company-info` to the screen map.
  - Documented the expected office-staff access scope: `admin / giamdoc / ketoan`.
- [docs/regression-testing/01-module-01-overview-dispatch.md](/Users/dev/Documents/projects/silversea/docs/regression-testing/01-module-01-overview-dispatch.md)
  - Added a dashboard note describing the company-info setup banner and its CTA to `/config/company-info`.

## Why No Broader Docs Change

- No command-line workflow changed.
- No public API contract changed.
- The governed save flow and schema-backed completeness rule are already enforced in code and tests; they do not need a separate new doc surface for this patch.
- There is no existing dedicated company-info product doc to update, so the regression docs are the correct durable home for this behavior.

## Validation

- Attempted to run `node .claude/scripts/validate-docs.cjs docs/`, but the repository does not contain `.claude/scripts/validate-docs.cjs`.
- The repo only has `.claude/settings.local.json`, so automated docs validation could not be completed with the documented command.

## Residual Risk

- The dashboard banner copy or route scope could drift again if the company-info
  workflow changes further; the regression docs should be revisited if that
  happens.

Status: DONE
