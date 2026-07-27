# Session 06 — FORWARDER field operations

**Environment:** staging  
**Execution mode:** authenticated browser, read-only  
**Build comparison:** inconclusive; no stable controller-equivalent fingerprint
was recomputed, and no public core asset filename change was observed

## Result

The FORWARDER lane rendered without horizontal overflow or unexpected
console/network failures across all six reachable role routes at desktop,
tablet, 390px, and 320px. Existing trip and settlement detail pages were
opened read-only. Office, finance, CUSTOMER, and DRIVER URLs redirected to the
FORWARDER home without exposing foreign content.

Screenshots were captured only after all text, images, video, and canvas
content had been masked in the live page. No staging identifier or operational
value is stored in the evidence.

## Route and viewport matrix

| Route pattern | Viewports | Result |
|---|---|---|
| `/my-forwarder-trips` | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/my-advances` | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/my-settlements` | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/my-forwarder-trips/:id` | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/my-settlements/:id` | 1440x900, 768x1024, 390x844, 320x568 | PASS |
| `/my-settlements/new` | 1440x900, 768x1024, 390x844, 320x568 | PASS — initial submit remains disabled |

Evidence: `qa/2026-07-27_customer-handover_s06_forwarder_*.png`.

## Isolation and error handling

| Check | Result |
|---|---|
| `/dashboard`, `/users`, `/reports/payables` | PASS — redirect to `/my-forwarder-trips` |
| `/portal/shipments`, `/my-trips` | PASS — redirect to `/my-forwarder-trips` |
| Missing trip identifier | PASS — expected 404 with generic Vietnamese error and no record content |
| Missing settlement identifier | PASS — expected 404 with generic error and no record content |

## Bounded coverage

| Case | Result | Reason |
|---|---|---|
| Browser print dialog | BLOCKED | Headless browser did not expose a verifiable preview or print callback |
| Trip/status persistence | NOT_RUN | Mutation not authorized |
| Expense/evidence upload | NOT_RUN | Mutation and real camera/file behavior not authorized |
| Settlement creation | NOT_RUN | Mutation not authorized |
| Own-versus-foreign positive fixture comparison | NOT_RUN | No controller-safe paired fixture |

The create form exposes one form and keeps its submit control disabled before
selection. Native checkbox inputs are wrapped by selectable labels; no form
was submitted.

## Counts

- Unique route/error patterns exercised: 13
- Responsive role-route cells: 24
- PASS: 32
- FAIL: 0
- BLOCKED: 1
- NOT_RUN: 4
- Unexpected console/network failures on reachable role routes: 0

Status: DONE_WITH_CONCERNS  
Summary: FORWARDER routes, existing details, responsive layouts, and route isolation passed read-only testing.  
Concerns/Blockers: Print preview is browser-blocked; mutation, upload/device, and paired ownership cases remain not run.
