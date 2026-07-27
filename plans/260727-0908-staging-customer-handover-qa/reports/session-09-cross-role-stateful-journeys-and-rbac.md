# Session 09 — Cross-role reconciliation and RBAC

**Execution mode:** read-only reconciliation of Sessions 01-08

## Role landing and direct-route isolation

| Role | Expected home | Result |
|---|---|---|
| ADMIN | `/dashboard` | PASS |
| MANAGER | `/dashboard` | PASS |
| ACCOUNTANT | `/dashboard` | PASS |
| DRIVER | `/my-trips` | PASS |
| FORWARDER | `/my-forwarder-trips` | PASS |
| CUSTOMER | `/portal/shipments` | PASS |
| CLERK | `/clerk/shipments/new` | PASS |

Verified direct-route checks returned CUSTOMER, DRIVER, FORWARDER, and CLERK
to their role-safe homes without rendering foreign-role content. This proves
shell-level route isolation for the exercised URLs; it does not prove every
API action or foreign-record identifier.

## Cross-role findings

- CUSTOMER `/portal/statement` is a confirmed functional failure:
  `GET /api/portal/statement` returned HTTP 404 at all four viewports.
- CUSTOMER logout is a confirmed functional failure: pointer and keyboard
  activation left the authenticated session active.
- CUSTOMER mobile account access is a confirmed functional failure: the
  account control remained collapsed after activation.
- MANAGER `/dispatch` and `/trips/:id` are confirmed noisy-load failures:
  `GET /api/admin/app-settings` returned HTTP 403 at desktop, tablet, and
  mobile widths.
- DRIVER and FORWARDER existing own-detail pages rendered read-only without
  unexpected request failures.
- The provisioned CLERK identity remained restricted to its role shell and
  direct forbidden routes redirected safely.

## Blocked and not-run cross-role coverage

- CUSTOMER own-versus-foreign shipment/debit-note/document checks:
  `BLOCKED / FIXTURE`.
- CLERK document-detail ownership: `BLOCKED / FIXTURE`.
- ADMIN, MANAGER, and ACCOUNTANT dynamic routes listed in their session
  reports: `BLOCKED / FIXTURE`.
- Maker/checker/approver, approved-record edits, period locks, double-submit,
  cross-user concurrent edits, and cross-role state propagation:
  `NOT_RUN / MUTATION_NOT_AUTHORIZED`.
- Real camera, GPS, offline, and device notification behavior:
  `NOT_RUN / REAL_DEVICE_REQUIRED`.

Q15-Q23 remain unsigned customer authority and are classified `NOT_RUN` in the
execution manifest rather than inferred from adjacent route evidence.

Status: DONE_WITH_CONCERNS  
Summary: Role homes and exercised direct-route isolation are coherent, but CUSTOMER failures, MANAGER normal-load 403s, and mutation/fixture gaps prevent functional certification.  
Concerns/Blockers: confirmed CUSTOMER defects, MANAGER app-settings 403s, fixture gaps, unsigned Q15-Q23, and mutation-dependent cross-role journeys.
