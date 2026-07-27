# Phase 1 — Portal contract and UI

## Touchpoints

- `backend/src/routes/portal/`
- `backend/src/index.ts`
- `backend/src/services/billingDocument.service.ts`
- `shared/src/types/index.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/pages/portal/`
- `frontend/src/lib/routes.ts`
- focused backend/frontend/E2E tests

## Implementation

1. Make role-home routing authoritative and keep CUSTOMER out of office screens.
2. Mount a CUSTOMER-only `/api/portal` surface and derive all row scope from the JWT.
3. Add own-resource list/detail, lifecycle action, debit-note export, and statement endpoints.
4. Add a distinct responsive customer shell using the existing design tokens and controls.
5. Add customer shipment, debit-note, and statement states and actions.
6. Prove role routing, API path correctness, lifecycle legality, downloads, and cross-customer denial.

## Risks and rollback

- Highest risk is cross-customer leakage; every detail/action/export rechecks ownership after lookup.
- Lifecycle mutations reuse the existing legal-transition service and are restricted to CUSTOMER.
- Existing office financial endpoints remain unchanged.
- Revert is limited to the portal router/shell and role routing; no data migration is required.

