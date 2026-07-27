# Session 08 — CLERK Coverage Contingency

Updated: 2026-07-27

Status: DONE_WITH_CONCERNS

## Scope

Read-only visual and functional QA for the CLERK lane after creating a dedicated staging clerk account:

- `/clerk/shipments/new`
- direct-denial checks for `/`, `/dashboard`, `/users`, `/config`, `/portal/shipments`, and unknown routes
- 1440×900, 768×1024, 390×844, 320×568

## Verified result

- Fingerprint start: `6a9fd0c76001faef691bddea19c8f1dca31b840ce9f2bd2fda344069dcd10225`
- Fingerprint end: `34549478e293120a406942bd043a107a5946967cfd36d50c86cded0e8c8f5379`
- PASS: 28
- BLOCKED: 1
- FAIL: 0

## Findings

- No console errors.
- No failed network requests.
- No horizontal overflow at the tested viewports.
- The new clerk account successfully reached `/clerk/shipments/new`.
- The form stayed usable at 320px, including the primary create action.
- Direct unauthorized routes returned to the clerk shell without exposing admin/customer data.

## Blocked coverage

- `/clerk/shipments/:id/docs` was not run because no safe shipment ID was discovered in read-only state.

## Evidence

- Screenshots: `qa/2026-07-27_customer-handover_clerk_*.png`
- Log: `qa/2026-07-27_customer-handover_s08_clerk_manual.log`

## Concerns / blockers

- The clerk detail/document path remains fixture-blocked.

## Account lifecycle closure

After Sessions 09 and 10 evidence closed, the controller changed only the
dedicated test CLERK account from ACTIVE to INACTIVE. The API returned HTTP
200, a subsequent user-list read confirmed role `CLERK` and status `INACTIVE`,
and a clean-browser login attempt remained on `/login` with an error and no
session token. No shared account was changed. The generic audit queries
returned HTTP 200 but did not expose a matching sanitized status event, so
audit-event proof is `BLOCKED / AUDIT_FILTER`.

Status: DONE_WITH_CONCERNS
Summary: The provisioned clerk account reaches the shipment-create surface cleanly, but the document-detail path could not be exercised without a safe shipment ID.
Counts: PASS 28 / FAIL 0 / BLOCKED 1 / NOT_RUN 0 / NOT_APPLICABLE 0
Concerns/Blockers: `/clerk/shipments/:id/docs` lacks a safe fixture; sanitized audit-event match was not available
