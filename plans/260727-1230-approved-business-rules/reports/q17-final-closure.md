# Q17 Final Closure

Date: 2026-07-28  
Lane: 2 — Q17 proof and CLERK boundary

## Outcome

Q17 was closed on the owned test surfaces without changing production route or page code.

The executable proof now covers:

- explicit pre-dispatch CLERK dossier edits for `pickupLocation`, `deliveryLocation`, and `blNumber`;
- explicit seal handling:
  - direct draft container/seal edit;
  - post-dispatch seal change request with persisted notification to dispatch recipients;
- explicit `DO` document attach/replace;
- explicit declaration create/update;
- representative authenticated CLERK denials on price, cost, debt, and salary mutation routes;
- frontend DO and seal editing workflows on mobile and desktop viewport setups.

## Implementation Notes

- Backend: extended `backend/src/tests/shipment-routes.test.ts`.
- Frontend: extended `frontend/src/pages/clerk/ClerkShipmentDocsPage.test.tsx`.
- No defect was exposed in `backend/src/routes/shipments.ts`, shipment services, or `frontend/src/pages/clerk/ClerkShipmentDocsPage.tsx`, so those files were not modified.
- One red→green fix was required in test scaffolding only: the CLERK JWT now includes `customerId/customerIds` after scope assignment so it matches the current auth contract for scoped CLERK users.

## QA Evidence

- `qa/2026-07-28_q17-final_backend-test.log`
- `qa/2026-07-28_q17-final_frontend-test.log`
- `qa/2026-07-28_q17-final_backend-typecheck.log`
- `qa/2026-07-28_q17-final_frontend-typecheck.log`
- `qa/2026-07-28_q17-final_lint.log`
- `qa/2026-07-28_q17-final_build.log`
- `qa/2026-07-28_q17-final_review.md`

## Result

- Backend targeted shipment route suite: green after one scaffolding fix.
- Frontend targeted clerk docs suite: green.
- Backend typecheck: green.
- Frontend typecheck: green.
- Root lint: green with 22 existing warnings, 0 errors.
- Build: green.

## Residual Note

The frontend mobile/desktop proof is executable component-test evidence rather than browser screenshot evidence.
