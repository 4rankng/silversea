# Phase 1 — Implement and verify

## Scope

- `frontend/src/App.tsx` and focused route tests
- `frontend/src/pages/DashboardPage.tsx`
- focused dashboard company-info banner component and tests
- shared company-info completeness authority and Configuration-page status
- QA evidence under `qa/`

## Non-goals

- No database or shared API schema change.
- No change to maker-checker governance or approval rules.
- No permission expansion for DRIVER, FORWARDER, CUSTOMER, or CLERK.
- No deployment or source push.

## Gates

- [ ] Focused route and banner tests pass.
- [ ] Backend and frontend typechecks pass.
- [ ] Backend and frontend test suites pass.
- [ ] Root lint, build, and E2E pass.
- [ ] Independent review approves the scoped diff.
- [ ] `pnpm context:check` passes.
